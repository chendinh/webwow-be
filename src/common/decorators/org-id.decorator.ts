import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @OrgId() — extracts the organizationId from:
 *   1. request.params.organizationId
 *   2. x-organization-id header (fallback)
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return (
      (request.params?.organizationId as string | undefined) ||
      (request.headers?.['x-organization-id'] as string | undefined)
    );
  },
);
