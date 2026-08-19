export const NESTJS_RULES = `
=== NESTJS RULES ===

── DEPENDENCY INJECTION ──
✗ WRONG: Instantiating services manually: const service = new UserService()
✓ RIGHT: Inject via constructor: constructor(private readonly userService: UserService)

✗ WRONG: Using process.env directly in services
✓ RIGHT: Inject ConfigService: constructor(private config: ConfigService) then config.get('key')

── MODULES ──
✗ WRONG: Using a service without importing its module
✓ RIGHT: Import the module in the consuming module's imports array, ensure service is in exports

── GUARDS & DECORATORS ──
✗ WRONG: Doing auth checks inside controller methods
✓ RIGHT: Use @UseGuards(JwtAuthGuard) on controller or method level

── DATABASE ──
✗ WRONG: Running multiple DB operations without transaction when they must be atomic
✓ RIGHT: Use prisma.$transaction([...]) for related writes

✗ WRONG: Fetching all records without pagination
✓ RIGHT: Always include take/skip or cursor for list endpoints

── ERROR HANDLING ──
✗ WRONG: Throwing generic Error: throw new Error('not found')
✓ RIGHT: Use NestJS exceptions: throw new NotFoundException('Resource not found')

── MULTI-TENANCY ──
✗ WRONG: Querying without organizationId filter
✓ RIGHT: Always filter by organizationId to enforce tenant isolation
`;

export const NESTJS_ANALYSIS_RULES = `
NESTJS FILE IDENTIFICATION RULES:
- src/modules/*/  = feature modules (controller + service + module)
- src/common/guards/ = JWT/auth guards applied globally or per-controller
- src/prisma/ = database service wrapper
- src/queue/ = BullMQ background job processors
`;
