import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

/**
 * JwtAuthGuard — extends Passport's JWT strategy guard.
 * Throws a friendly UnauthorizedException when the token is missing or invalid.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser | false,
    info: { message?: string } | undefined,
  ): TUser {
    if (err || !user) {
      const message = this.buildMessage(info);
      throw new UnauthorizedException(message);
    }
    return user;
  }

  private buildMessage(info?: { message?: string } | undefined): string {
    if (!info) return 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.';

    const raw = info.message ?? '';

    if (raw.toLowerCase().includes('expired')) {
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    }

    if (raw.toLowerCase().includes('no auth')) {
      return 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.';
    }

    return 'Token không hợp lệ. Vui lòng đăng nhập lại.';
  }
}
