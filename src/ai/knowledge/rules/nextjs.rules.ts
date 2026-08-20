/**
 * Next.js App Router knowledge base.
 * These rules are injected into AI agents when the project uses Next.js.
 * Each rule has a category, severity, and concrete example of what NOT to do vs what to do.
 */
export const NEXTJS_RULES = `
=== NEXT.JS APP ROUTER RULES ===
(Violations cause build failures or runtime errors — follow strictly)

── SERVER vs CLIENT COMPONENTS ──
✗ WRONG: Adding "use client" to a file that exports "metadata"
✓ RIGHT: Keep layout.tsx as Server Component; wrap interactive parts in a separate ThemeProvider.tsx with "use client"

✗ WRONG: Using useState/useEffect/useContext in a file without "use client"
✓ RIGHT: Mark the file "use client" at line 1 (before imports), or extract to a Client Component

✗ WRONG: Putting "use client" on line 3 after imports
✓ RIGHT: "use client" MUST be the very first line of the file

✗ WRONG: Exporting metadata from a Client Component
✓ RIGHT: metadata export only works in Server Components (no "use client")

── ROUTING ──
✗ WRONG: Using useRouter() or usePathname() in a Server Component
✓ RIGHT: These hooks only work in Client Components

✗ WRONG: Fetching data in a Client Component with useEffect
✓ RIGHT: Fetch in Server Components with async/await, pass data as props

── LAYOUT PATTERN FOR INTERACTIVITY ──
When layout.tsx needs both metadata AND client state (e.g. theme):
1. Keep src/app/layout.tsx as Server Component — exports metadata, renders <html><body>
2. Create src/app/providers.tsx as "use client" — wraps children with context/state
3. layout.tsx imports and renders <Providers>{children}</Providers>

── TAILWIND DARK MODE ──
✗ WRONG: Toggling dark mode with CSS variables on :root
✓ RIGHT: Add "dark" class to <html> element; use Tailwind dark: prefix classes
✓ PATTERN: document.documentElement.classList.toggle('dark')

── IMAGE OPTIMIZATION ──
✗ WRONG: Using <img> tags for content images
✓ RIGHT: Use next/image <Image> component for automatic optimization

── LINK NAVIGATION ──
✗ WRONG: Using <a href="/page"> for internal navigation
✓ RIGHT: Use next/link <Link href="/page"> for client-side navigation

── APP ROUTER vs PAGES ROUTER ──
✗ WRONG: import { Html, Head, Main, NextScript } from 'next/document' in App Router
✓ RIGHT: These are Pages Router ONLY — App Router uses plain <html>, <head>, <body> tags directly in layout.tsx
✗ WRONG: import { Html } from 'next/document' anywhere in src/app/
✓ RIGHT: layout.tsx uses: return (<html lang="en"><body>{children}</body></html>)

── ZUSTAND WITH PERSIST ──
✗ WRONG: import { persist } from 'zustand/middleware' and use createJSONStorage without importing it
✓ RIGHT: import { persist, createJSONStorage } from 'zustand/middleware'
✗ WRONG: Importing a Zustand store hook (useXxxStore) in a Server Component or layout.tsx
✓ RIGHT: Zustand hooks only in Client Components marked "use client"

── ZUSTAND PERSIST + SSR / STATIC GENERATION (CRITICAL) ──
✗ WRONG: Using localStorage/sessionStorage directly in persist storage config at module level
  This causes: TypeError: Cannot read properties of null (reading 'useContext') during next build static generation
✓ RIGHT: Always guard localStorage access to avoid SSR crash:
  const useThemeStore = create(persist(
    (set) => ({ theme: 'dark', setTheme: (t) => set({ theme: t }) }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        return localStorage;
      }),
      skipHydration: true,
    }
  ));

✗ WRONG: Calling useThemeStore() directly in ThemeProvider render without hydration guard
✓ RIGHT: Use useEffect + useState to prevent SSR mismatch:
  function ThemeProvider({ children }) {
    const [mounted, setMounted] = useState(false);
    const theme = useThemeStore(s => s.theme);
    useEffect(() => { setMounted(true); }, []);
    useEffect(() => {
      if (!mounted) return;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, [theme, mounted]);
    if (!mounted) return <>{children}</>; // avoid hydration mismatch
    return <>{children}</>;
  }

✗ WRONG: Theme toggle component reads store without mounted guard
✓ RIGHT: Always check mounted state before rendering theme-dependent UI

── THEME SCRIPT FOR FLASH PREVENTION ──
✗ WRONG: Using <script dangerouslySetInnerHTML> inside a "use client" component
✓ RIGHT: Inline script goes in Server Component layout.tsx as:
  <script dangerouslySetInnerHTML={{ __html: \`(function(){var t=localStorage.getItem('theme-storage');if(t){var p=JSON.parse(t);if(p.state&&p.state.theme==='light')document.documentElement.classList.remove('dark');else document.documentElement.classList.add('dark');}else{document.documentElement.classList.add('dark');}})()\` }} />
  This runs before React hydrates — no ThemeScript component needed.
`;

export const NEXTJS_ANALYSIS_RULES = `
NEXT.JS FILE IDENTIFICATION RULES:
- src/app/layout.tsx = root Server Component, exports metadata, NEVER add "use client"
- src/app/page.tsx = Server Component by default unless needs interactivity
- src/components/layout/ = shared UI components, usually need "use client" for interactivity
- src/stores/*.ts = Zustand stores, client-side only, imported only in Client Components
- src/lib/hooks/ = custom hooks, only usable in Client Components
- Files using useState/useEffect/useContext MUST be Client Components
`;
