import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../../../common/types/jwt-payload.type';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Extract from body.refreshToken or Authorization header as fallback
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.body?.refreshToken ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload & { refreshToken: string }> {
    // Extract the raw refresh token from body or header
    const refreshToken: string =
      req?.body?.refreshToken ??
      req?.headers?.authorization?.replace('Bearer ', '') ??
      '';

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not provided');
    }

    // Verify the token exists in DB and has not been revoked or expired
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, deletedAt: true } } },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    if (storedToken.revokedAt !== null) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (storedToken.user.deletedAt !== null) {
      throw new UnauthorizedException('User account has been deleted');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      refreshToken,
    };
  }
}
