export const TYPESCRIPT_RULES = `
=== TYPESCRIPT RULES ===

── TYPE SAFETY ──
✗ WRONG: Using "any" type to bypass errors: const data: any = response
✓ RIGHT: Define proper interface or use "unknown" with type narrowing

✗ WRONG: Non-null assertion without checking: user!.profile.name
✓ RIGHT: Use optional chaining: user?.profile?.name ?? 'Unknown'

✗ WRONG: Type casting without validation: const user = data as User
✓ RIGHT: Validate with Zod or type guard before casting

── NULL HANDLING ──
✗ WRONG: Accessing property without null check: obj.prop (when obj can be null)
✓ RIGHT: obj?.prop or explicit null check before access

── IMPORTS ──
✗ WRONG: Importing types at runtime: import { MyType } from './types'
✓ RIGHT: Use import type: import type { MyType } from './types'

── ENUMS ──
✗ WRONG: String comparisons with enum: if (status === 'ACTIVE')
✓ RIGHT: if (status === Status.ACTIVE)

── ASYNC ──
✗ WRONG: Async function without error handling: async () => { await fetch() }
✓ RIGHT: Always wrap in try/catch or use .catch() chaining
`;

export const TYPESCRIPT_ANALYSIS_RULES = `
TYPESCRIPT FILE IDENTIFICATION RULES:
- .ts files = pure TypeScript logic, no JSX
- .tsx files = TypeScript with JSX (React components)
- tsconfig.json strict: true = extra null checks required throughout codebase
`;
