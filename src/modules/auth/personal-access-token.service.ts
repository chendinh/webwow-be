import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PersonalAccessTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a new PAT for a user. Returns the raw token ONCE — never stored in plaintext.
   * Token format: wwt_{32 random hex chars}
   */
  async create(
    userId: string,
    name: string,
    expiresInDays?: number,
  ): Promise<{
    token: string;
    id: string;
    tokenPrefix: string;
    name: string;
    expiresAt: Date | null;
    scopes: string[];
    createdAt: Date;
  }> {
    const rawToken = `wwt_${crypto.randomBytes(16).toString('hex')}`;
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const tokenPrefix = rawToken.substring(0, 10); // "wwt_abcd12" — safe to display

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const pat = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name,
        tokenHash,
        tokenPrefix,
        expiresAt,
        scopes: ['read:projects', 'write:issues'],
      },
    });

    return {
      token: rawToken, // ONLY returned here, never again
      id: pat.id,
      tokenPrefix: pat.tokenPrefix,
      name: pat.name,
      expiresAt: pat.expiresAt,
      scopes: pat.scopes,
      createdAt: pat.createdAt,
    };
  }

  /**
   * Validate a PAT and return the associated user.
   * Updates lastUsedAt on success.
   */
  async validate(rawToken: string): Promise<{ userId: string; scopes: string[] }> {
    if (!rawToken.startsWith('wwt_')) {
      throw new UnauthorizedException('Invalid token format');
    }

    // Find candidates by prefix (first 10 chars)
    const prefix = rawToken.substring(0, 10);
    const candidates = await this.prisma.personalAccessToken.findMany({
      where: {
        tokenPrefix: prefix,
        revokedAt: null,
      },
    });

    for (const pat of candidates) {
      // Check expiry
      if (pat.expiresAt && pat.expiresAt < new Date()) continue;

      const matches = await bcrypt.compare(rawToken, pat.tokenHash);
      if (matches) {
        // Update lastUsedAt
        await this.prisma.personalAccessToken.update({
          where: { id: pat.id },
          data: { lastUsedAt: new Date() },
        });
        return { userId: pat.userId, scopes: pat.scopes };
      }
    }

    throw new UnauthorizedException('Invalid or expired token');
  }

  /**
   * List all active PATs for a user (without token hash).
   */
  async list(userId: string) {
    return this.prisma.personalAccessToken.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke a PAT (soft delete).
   */
  async revoke(tokenId: string, userId: string): Promise<void> {
    const pat = await this.prisma.personalAccessToken.findFirst({
      where: { id: tokenId, userId, revokedAt: null },
    });
    if (!pat) throw new NotFoundException('Token not found');

    await this.prisma.personalAccessToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }
}
