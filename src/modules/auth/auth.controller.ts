import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types/jwt-payload.type';

import { AuthService, AuthTokensResponse } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';
import { GithubOauthUser } from './strategies/github-oauth.strategy';

// ─── Extended request types ──────────────────────────────────────────────────

interface RequestWithRefreshUser extends Request {
  user: JwtPayload & { refreshToken: string };
}

interface RequestWithGithubUser extends Request {
  user: GithubOauthUser;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── POST /api/auth/register ────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công, trả về access + refresh token.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ.' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại.' })
  async register(@Body() dto: RegisterDto): Promise<AuthTokensResponse> {
    return this.authService.register(dto);
  }

  // ── POST /api/auth/login ───────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Đăng nhập bằng email và mật khẩu' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công, trả về access + refresh token.' })
  @ApiResponse({ status: 401, description: 'Email hoặc mật khẩu không đúng.' })
  @ApiResponse({ status: 429, description: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' })
  async login(@Body() dto: LoginDto): Promise<AuthTokensResponse> {
    return this.authService.login(dto);
  }

  // ── POST /api/auth/refresh ─────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiOperation({ summary: 'Làm mới access token bằng refresh token' })
  @ApiResponse({ status: 200, description: 'Trả về access token mới.' })
  @ApiResponse({ status: 401, description: 'Refresh token không hợp lệ hoặc đã hết hạn.' })
  async refresh(
    @Req() req: RequestWithRefreshUser,
  ): Promise<{ accessToken: string }> {
    const { sub: userId, refreshToken } = req.user;
    return this.authService.refresh(refreshToken, userId);
  }

  // ── POST /api/auth/logout ──────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Đăng xuất và thu hồi refresh token' })
  @ApiResponse({ status: 204, description: 'Đăng xuất thành công.' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập.' })
  async logout(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() _user: JwtPayload,
  ): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  // ── GET /api/auth/github ───────────────────────────────────────────────────

  @Get('github')
  @UseGuards(AuthGuard('github'))
  @Redirect()
  @ApiOperation({ summary: 'Chuyển hướng đến GitHub OAuth' })
  @ApiResponse({ status: 302, description: 'Chuyển hướng đến trang xác thực GitHub.' })
  githubLogin(): void {
    // Passport's GitHub strategy handles the redirect automatically.
    // This method body is intentionally empty.
  }

  // ── GET /api/auth/github/callback ─────────────────────────────────────────

  @Get('github/callback')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth callback — trả về token sau khi xác thực' })
  @ApiResponse({ status: 200, description: 'Xác thực GitHub thành công, trả về access + refresh token.' })
  @ApiResponse({ status: 401, description: 'Xác thực GitHub thất bại.' })
  async githubCallback(
    @Req() req: RequestWithGithubUser,
  ): Promise<AuthTokensResponse> {
    const githubUser = req.user;
    return this.authService.generateTokenPair(
      githubUser.id,
      githubUser.email,
      {
        id: githubUser.id,
        email: githubUser.email,
        name: githubUser.name,
        emailVerified: true,
      },
    );
  }

  // ── POST /api/auth/verify-email ────────────────────────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xác thực địa chỉ email bằng token' })
  @ApiResponse({ status: 204, description: 'Xác thực email thành công.' })
  @ApiResponse({ status: 400, description: 'Token không hợp lệ hoặc đã hết hạn.' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.authService.verifyEmail(dto.token);
  }

  // ── POST /api/auth/forgot-password ────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Gửi email đặt lại mật khẩu' })
  @ApiResponse({ status: 204, description: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(dto.email);
  }

  // ── POST /api/auth/reset-password ─────────────────────────────────────────

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đặt lại mật khẩu bằng token reset' })
  @ApiResponse({ status: 204, description: 'Mật khẩu đã được đặt lại thành công.' })
  @ApiResponse({ status: 400, description: 'Token không hợp lệ hoặc đã hết hạn.' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password);
  }
}
