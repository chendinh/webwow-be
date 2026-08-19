import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../types/jwt-payload.type';

/**
 * RolesGuard — verifies the authenticated user has the required OrgRole
 * for the target organization.
 *
 * Resolution order for organizationId:
 *   1. request.params.organizationId
 *   2. x-organization-id header
 *
 * PrismaService is injected as optional so the guard compiles cleanly
 * even before the full Auth module is wired up. When Prisma is unavailable
 * the guard denies access to protect against misconfiguration.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — guard is a no-op
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: Record<string, string>;
      headers?: Record<string, string>;
    }>();

    const user = request.user;
    if (!user?.sub) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập tài nguyên này.',
      );
    }

    const organizationId =
      request.params?.['organizationId'] ??
      request.headers?.['x-organization-id'];

    if (!organizationId) {
      this.logger.warn(
        `RolesGuard: organizationId not found in params or headers for user ${user.sub}`,
      );
      throw new ForbiddenException(
        'Không xác định được tổ chức. Vui lòng kiểm tra lại yêu cầu.',
      );
    }

    if (!this.prisma) {
      // PrismaService not yet available (e.g., during early startup tests)
      this.logger.warn('RolesGuard: PrismaService not available — denying access');
      throw new ForbiddenException(
        'Bạn không có quyền truy cập tài nguyên này.',
      );
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.sub,
        },
      },
      select: { role: true, joinedAt: true },
    });

    if (!membership || membership.joinedAt === null) {
      throw new ForbiddenException(
        'Bạn không phải là thành viên của tổ chức này.',
      );
    }

    if (!requiredRoles.includes(membership.role)) {
      this.logger.warn(
        `RolesGuard: user ${user.sub} has role ${membership.role} but needs one of [${requiredRoles.join(', ')}] in org ${organizationId}`,
      );
      throw new ForbiddenException(
        'Bạn không có đủ quyền để thực hiện hành động này.',
      );
    }

    return true;
  }
}
