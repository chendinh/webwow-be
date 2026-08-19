export const PRISMA_RULES = `
=== PRISMA RULES ===

── SCHEMA CHANGES ──
✗ WRONG: Adding new fields without migration
✓ RIGHT: Always run prisma migrate dev after schema changes; never edit DB directly

✗ WRONG: Deleting fields from schema without data migration plan
✓ RIGHT: Mark as optional first, migrate data, then remove

── QUERIES ──
✗ WRONG: N+1 queries: fetching related data in a loop
✓ RIGHT: Use include/select in single query: findMany({ include: { orders: true } })

✗ WRONG: Selecting all fields when only needing a few
✓ RIGHT: Use select to specify exact fields needed

── TRANSACTIONS ──
✗ WRONG: Multiple related writes without transaction
✓ RIGHT: prisma.$transaction([prisma.user.update(...), prisma.order.create(...)])

── JSON FIELDS ──
✗ WRONG: Storing structured data as JSON without type casting
✓ RIGHT: Cast with: data as unknown as Prisma.JsonObject when saving; parse on read

── SOFT DELETE ──
✗ WRONG: Hard deleting records that may be referenced
✓ RIGHT: Set deletedAt timestamp; always filter where: { deletedAt: null } in queries

── MULTI-TENANT ISOLATION ──
✗ WRONG: Any query without organizationId filter on tenant-scoped models
✓ RIGHT: Every findMany/findFirst on tenant models must include { organizationId }
`;

export const PRISMA_ANALYSIS_RULES = `
PRISMA FILE IDENTIFICATION RULES:
- prisma/schema.prisma = source of truth for all models and relations
- src/prisma/prisma.service.ts = injectable database client
- All DB access goes through PrismaService, never raw SQL
`;
