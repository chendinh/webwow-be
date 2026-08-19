export const REACT_RULES = `
=== REACT RULES ===

── HOOKS ──
✗ WRONG: Calling hooks conditionally: if (condition) { useState(...) }
✓ RIGHT: Hooks always at top level of component, never inside conditions/loops

✗ WRONG: Calling hooks outside component or custom hook
✓ RIGHT: Hooks only inside function components or custom hooks (useXxx)

✗ WRONG: Missing dependency in useEffect: useEffect(() => { fn(value) }, [])
✓ RIGHT: Include all used values: useEffect(() => { fn(value) }, [value])

── STATE & EFFECTS ──
✗ WRONG: Mutating state directly: state.items.push(item)
✓ RIGHT: setState([...state.items, item])

✗ WRONG: Causing infinite loop: useEffect(() => { setX(x + 1) }, [x])
✓ RIGHT: Use functional update or separate the trigger

✗ WRONG: Not cleaning up effects with timers/subscriptions
✓ RIGHT: return () => clearInterval(id) / subscription.unsubscribe()

── PERFORMANCE ──
✗ WRONG: Creating new objects/arrays in render for stable props
✓ RIGHT: useMemo/useCallback for expensive computations passed as props

── KEYS ──
✗ WRONG: Using array index as key when list can reorder: key={i}
✓ RIGHT: Use stable unique id: key={item.id}
`;

export const REACT_ANALYSIS_RULES = `
REACT FILE IDENTIFICATION RULES:
- Components using useState/useEffect need "use client" in Next.js App Router
- Custom hooks (useXxx.ts) are client-only utilities
- Context providers wrap children and manage shared state
`;
