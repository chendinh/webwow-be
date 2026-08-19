export const ZUSTAND_RULES = `
=== ZUSTAND RULES ===

── STORE STRUCTURE ──
✗ WRONG: Putting async logic directly in state: { data: await fetch() }
✓ RIGHT: Async actions in the store: { fetchData: async () => { const d = await fetch(); set({data: d}) } }

✗ WRONG: Accessing store outside React context with useStore()
✓ RIGHT: Use useStore.getState() for access outside components

── IMPORTS ──
✗ WRONG: import { persist } from 'zustand/middleware' then use createJSONStorage without importing it
✓ RIGHT: import { persist, createJSONStorage } from 'zustand/middleware'

✗ WRONG: import { devtools } from 'zustand/middleware' without having it in dependencies
✓ RIGHT: Only import middleware that's actually used

── PERSISTENCE ──
✗ WRONG: Using persist without specifying storage
✓ RIGHT: persist(fn, { name: 'key', storage: createJSONStorage(() => localStorage) })

── SELECTORS ──
✗ WRONG: Subscribing to entire store: const state = useStore()
✓ RIGHT: Use selector: const count = useStore(s => s.count) — prevents unnecessary re-renders

── IMMUTABILITY ──
✗ WRONG: Mutating nested state: set(s => { s.user.name = 'new' })
✓ RIGHT: Spread to create new object: set(s => ({ user: { ...s.user, name: 'new' } }))
`;

export const ZUSTAND_ANALYSIS_RULES = `
ZUSTAND FILE IDENTIFICATION RULES:
- src/stores/*.store.ts = Zustand store definitions
- Stores are Client-side only — import only in Client Components or hooks
- Use persist middleware for data that should survive page refreshes
`;
