export const TAILWIND_RULES = `
=== TAILWIND CSS RULES ===

── DARK MODE ──
✗ WRONG: Using CSS variables for dark mode: --bg-color: #000
✓ RIGHT: Use Tailwind dark: prefix: className="bg-white dark:bg-gray-950"
✓ RIGHT: Toggle dark class on <html>: document.documentElement.classList.toggle('dark')
✓ RIGHT: tailwind.config: darkMode: 'class'

── CLASS COMPOSITION ──
✗ WRONG: Building class strings with concatenation: "text-" + color + "-500"
✓ RIGHT: Use cn() or clsx() utility: cn("text-red-500", isActive && "font-bold")

✗ WRONG: Duplicate/conflicting classes: "px-4 px-8" (px-4 gets overridden silently)
✓ RIGHT: Use tailwind-merge: twMerge("px-4", override) to merge safely

── RESPONSIVE ──
✗ WRONG: Mobile styles as overrides: "sm:text-sm text-base"
✓ RIGHT: Mobile-first base, then breakpoints: "text-sm sm:text-base lg:text-lg"

── CUSTOM COLORS ──
✗ WRONG: Inline color styles: style={{ color: '#abc123' }}
✓ RIGHT: Extend tailwind.config theme.extend.colors and use utility classes

── ANIMATION ──
✗ WRONG: Custom CSS keyframes for common animations
✓ RIGHT: Use Tailwind animate-spin, animate-ping, animate-bounce, animate-pulse
`;

export const TAILWIND_ANALYSIS_RULES = `
TAILWIND FILE IDENTIFICATION RULES:
- tailwind.config.ts = darkMode setting, custom colors, content paths
- globals.css = @tailwind directives, CSS variables, base layer overrides
- Components use className with Tailwind utilities, not style={{}}
`;
