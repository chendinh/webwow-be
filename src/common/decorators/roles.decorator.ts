import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * @Roles(OrgRole.OWNER, OrgRole.ADMIN) — specifies which roles are allowed
 * to access a route. Used in conjunction with RolesGuard.
 *
 * @example
 * @Roles(OrgRole.OWNER, OrgRole.ADMIN)
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Get('sensitive-endpoint')
 * sensitiveEndpoint() { ... }
 */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
