import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { PrismaService } from '../../../prisma/prisma.service';
import { User } from '@prisma/client';

export interface GithubOauthUser {
  id: string;
  email: string;
  name: string | null;
  githubId: string;
  githubUsername: string;
  avatarUrl: string | null;
}

@Injectable()
export class GithubOauthStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      clientID: configService.get<string>('github.oauthClientId') ?? '',
      clientSecret: configService.get<string>('github.oauthClientSecret') ?? '',
      callbackURL: configService.get<string>('github.oauthCallbackUrl') ?? '/auth/github/callback',
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (error: Error | null, user?: GithubOauthUser) => void,
  ): Promise<void> {
    try {
      const githubId = profile.id;
      const email =
        profile.emails?.[0]?.value ??
        `${profile.username}@users.noreply.github.com`;
      const name = profile.displayName ?? profile.username ?? null;
      const githubUsername = profile.username ?? '';
      const avatarUrl = (profile.photos?.[0]?.value as string) ?? null;

      // Find existing user by githubId first, then by email
      let user: User | null = await this.prisma.user.findUnique({
        where: { githubId },
      });

      if (!user && email) {
        user = await this.prisma.user.findUnique({ where: { email } });
      }

      if (user) {
        // Update GitHub info on existing account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            githubId,
            githubUsername,
            avatarUrl: avatarUrl ?? user.avatarUrl,
            name: user.name ?? name,
          },
        });
      } else {
        // Create new user via GitHub
        user = await this.prisma.user.create({
          data: {
            email,
            githubId,
            githubUsername,
            name,
            avatarUrl,
            emailVerified: true, // GitHub email is trusted
          },
        });
      }

      const result: GithubOauthUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        githubId: user.githubId!,
        githubUsername: user.githubUsername!,
        avatarUrl: user.avatarUrl,
      };

      done(null, result);
    } catch (error) {
      done(error as Error);
    }
  }
}
