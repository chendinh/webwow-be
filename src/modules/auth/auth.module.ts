import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GithubOauthStrategy } from './strategies/github-oauth.strategy';
import { PersonalAccessTokenService } from './personal-access-token.service';
import { PATController } from './pat.controller';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiry', '15m'),
        },
      }),
    }),
    PrismaModule,
  ],
  controllers: [AuthController, PATController],
  providers: [
    AuthService,
    PersonalAccessTokenService,
    JwtStrategy,
    JwtRefreshStrategy,
    GithubOauthStrategy,
  ],
  exports: [AuthService, JwtModule, PersonalAccessTokenService],
})
export class AuthModule {}
