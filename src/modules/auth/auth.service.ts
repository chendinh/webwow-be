import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// ─── Response interface ──────────────────────────────────────────────────────

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
  };
}

// ─── Stub interface for NotificationsService ────────────────────────────────
// NotificationsService is not yet built; injected as @Optional() so the module
// compiles and tests run without it wired up.

export interface INotificationsService {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

export const NOTIFICATIONS_SERVICE = Symbol('NOTIFICATIONS_SERVICE');

// ─── Constants ───────────────────────────────────────────────────────────────

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Vietnamese customer-friendly messages (aligned with GlobalExceptionFilter)
const MSG = {
  EMAIL_TAKEN: 'Địa chỉ email này đã được sử dụng. Vui lòng dùng email khác.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng. Vui lòng thử lại.',
  ACCOUNT_LOCKED:
    'Tài khoản của bạn đã bị khóa tạm thời do đăng nhập thất bại nhiều lần. Vui lòng thử lại sau 15 phút.',
  INVALID_VERIFY_TOKEN: 'Liên kết xác thực email không hợp lệ hoặc đã hết hạn.',
  INVALID_RESET_TOKEN: 'Liên kết đặt lại mật khẩu không hợp lệ.',
  RESET_TOKEN_EXPIRED: 'Liên kết đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu lại.',
} as const;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly notificationsService?: INotificationsService,
  ) {}

  // ── Register ────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<AuthTokensResponse> {
    // Check email uniqueness
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(MSG.EMAIL_TAKEN);
    }

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    // Generate email verification token
    const emailVerifyToken = uuidv4();

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name ?? null,
        emailVerified: false,
        emailVerifyToken,
      },
      select: { id: true, email: true, name: true, emailVerified: true },
    });

    // Send verification email (fire-and-forget; NotificationsService may not be ready)
    this.sendVerificationEmail(user.email, emailVerifyToken).catch((err) => {
      this.logger.warn(`Failed to send verification email to ${user.email}: ${String(err)}`);
    });

    return this.generateTokenPair(user.id, user.email, {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    });
  }

  // ── Login ────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const normalizedEmail = dto.email.toLowerCase();

    // Find user — same error for "not found" and "wrong password" (prevent enumeration)
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(MSG.ACCOUNT_LOCKED);
    }

    // Verify password
    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      await this.handleFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);
    }

    // Successful login — reset lockout state
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    return this.generateTokenPair(user.id, user.email, {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    });
  }

  // ── Refresh ──────────────────────────────────────────────────────────────────
  // Called after JwtRefreshStrategy has already validated the token in DB.

  async refresh(
    refreshToken: string,
    userId: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);
    }

    const accessToken = this.signAccessToken(user.id, user.email);
    return { accessToken };
  }

  // ── Logout ───────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Verify email ─────────────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { emailVerifyToken: token },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException(MSG.INVALID_VERIFY_TOKEN);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null },
    });
  }

  // ── Forgot password ───────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    // Silently return — don't reveal whether email exists
    if (!user) {
      return;
    }

    const resetToken = uuidv4();
    const resetExpiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpiry: resetExpiry,
      },
    });

    this.sendPasswordResetEmail(user.email, resetToken).catch((err) => {
      this.logger.warn(`Failed to send password reset email to ${user.email}: ${String(err)}`);
    });
  }

  // ── Reset password ────────────────────────────────────────────────────────────

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { resetPasswordToken: token },
      select: { id: true, resetPasswordExpiry: true },
    });

    if (!user) {
      throw new BadRequestException(MSG.INVALID_RESET_TOKEN);
    }

    if (!user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) {
      throw new BadRequestException(MSG.RESET_TOKEN_EXPIRED);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Signs access + refresh tokens and persists the refresh token to DB.
   */
  async generateTokenPair(
    userId: string,
    email: string,
    userInfo: { id: string; email: string; name: string | null; emailVerified: boolean },
  ): Promise<AuthTokensResponse> {
    const accessToken = this.signAccessToken(userId, email);

    // Refresh token is a random UUID stored in DB (not a JWT)
    const refreshToken = uuidv4();
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: userInfo,
    };
  }

  private signAccessToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private async handleFailedLogin(
    userId: string,
    currentFailedAttempts: number,
  ): Promise<void> {
    const newFailedAttempts = currentFailedAttempts + 1;

    let lockedUntil: Date | null = null;
    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      this.logger.warn(
        `[SECURITY] Account ${userId} locked until ${lockedUntil.toISOString()} after ${newFailedAttempts} failed login attempts`,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: newFailedAttempts,
        lockedUntil,
      },
    });
  }

  private async sendVerificationEmail(
    email: string,
    token: string,
  ): Promise<void> {
    if (!this.notificationsService) return;

    const verifyUrl = `${this.configService.get<string>('app.frontendUrl', 'http://localhost:3001')}/verify-email?token=${token}`;
    await this.notificationsService.sendEmail(
      email,
      'Xác thực địa chỉ email của bạn',
      `Vui lòng nhấp vào liên kết sau để xác thực email của bạn: ${verifyUrl}\n\nLiên kết có hiệu lực trong 24 giờ.`,
    );
  }

  private async sendPasswordResetEmail(
    email: string,
    token: string,
  ): Promise<void> {
    if (!this.notificationsService) return;

    const resetUrl = `${this.configService.get<string>('app.frontendUrl', 'http://localhost:3001')}/reset-password?token=${token}`;
    await this.notificationsService.sendEmail(
      email,
      'Đặt lại mật khẩu',
      `Bạn đã yêu cầu đặt lại mật khẩu. Nhấp vào liên kết sau để tiếp tục: ${resetUrl}\n\nLiên kết có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu điều này, hãy bỏ qua email này.`,
    );
  }
}
