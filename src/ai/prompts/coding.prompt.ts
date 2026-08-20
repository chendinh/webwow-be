function getLanguageName(code: string): string {
  const map: Record<string, string> = {
    vi: 'Vietnamese',
    zh: 'Chinese (Simplified)',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    pt: 'Portuguese',
  };
  return map[code] ?? 'English';
}

// ─── Framework-specific coding rules ──────────────────────────────────────────
// These are injected into the system prompt based on detected framework.
// They encode non-obvious rules that AI commonly gets wrong.

const FRAMEWORK_RULES: Record<string, string> = {
  'next.js': `
NEXT.JS APP ROUTER RULES (strictly enforced — violations cause build failures):
1. SERVER COMPONENTS (default): Can export "metadata", can use async/await, CANNOT use hooks (useState, useEffect, etc.), CANNOT be marked "use client"
2. CLIENT COMPONENTS: Must have "use client" at the very top, CAN use hooks, CANNOT export "metadata" or "generateStaticParams"
3. CRITICAL: A file with "export const metadata" MUST NOT have "use client" — these are mutually exclusive
4. layout.tsx that needs both metadata AND interactivity: Keep layout.tsx as Server Component, extract interactive parts into a separate Client Component (e.g. ThemeProvider.tsx) and import it
5. When adding theme/state to layout.tsx: Create a wrapper Client Component, do NOT add "use client" to layout.tsx itself
6. Hooks (useState, useContext, useEffect) belong in files marked "use client" only
7. "use client" must be the FIRST line of the file (before any imports)
8. NEVER import Html, Head, Main, NextScript from "next/document" in the App Router (src/app/) — those are Pages Router only. Use plain <html> and <body> tags directly in layout.tsx
9. TypeError: Cannot read properties of null (reading 'useContext') during build = a Context hook (useTheme, useContext, etc.) is being called in a Server Component or at module level. Fix: ensure the component calling the hook has "use client" at the top, and is only rendered inside the matching Provider
10. ZUSTAND PERSIST + SSR: localStorage is undefined on the server during static generation. ALWAYS guard:
    storage: createJSONStorage(() => {
      if (typeof window === 'undefined') return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
      return localStorage;
    }),
    skipHydration: true,
    Without this guard, next build will crash with "Cannot read properties of null (reading 'useContext')"
11. ThemeProvider must use mounted guard: const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); if (!mounted) return <>{children}</>;
12. For flash-of-unstyled-theme prevention: add inline <script dangerouslySetInnerHTML> directly in layout.tsx body tag — NOT in a separate component with "use client"`,

  'react': `
REACT RULES:
1. Hooks must be called inside function component bodies only
2. Custom hooks must start with "use"
3. useEffect cleanup: return a cleanup function for subscriptions/timers`,

  'nestjs': `
NESTJS RULES:
1. Services must be decorated with @Injectable()
2. Controllers must be decorated with @Controller()
3. All dependencies injected via constructor, never instantiated manually
4. Use ConfigService for env vars, never process.env directly in services`,
};

function getFrameworkRules(framework: string): string {
  const key = Object.keys(FRAMEWORK_RULES).find(k =>
    framework.toLowerCase().includes(k.toLowerCase())
  );
  return key ? FRAMEWORK_RULES[key] : '';
}

export class CodingPrompt {
  /**
   * System prompt specifically for the fix-build-errors path.
   * Overrides the implementStep system prompt to enforce JSON array output.
   */
  static buildFixSystem(language = 'en', framework = '', rulebookRules = ''): string {
    const rules = rulebookRules || getFrameworkRules(framework);
    const rulesSection = rules ? `\n${rules}` : '';

    const langInstruction =
      language !== 'en'
        ? `\n\nWrite code comments in ${getLanguageName(language)} when adding new comments.`
        : '';

    return `You are a senior software engineer fixing build errors.${langInstruction}${rulesSection}

Your ONLY job is to return a JSON array of file fixes. NOTHING ELSE.

OUTPUT FORMAT — you MUST return exactly this structure:
[
  { "filePath": "src/app/layout.tsx", "type": "MODIFY", "content": "<complete file content>" },
  { "filePath": "src/components/providers.tsx", "type": "CREATE", "content": "<complete file content>" }
]

ABSOLUTE RULES:
- Output ONLY the JSON array — no prose, no markdown fences, no explanation before or after
- Every "content" field must be the complete file content, not a diff or snippet
- Your first character MUST be "[" and your last character MUST be "]"
- If you write ANY text before "[", the entire response is invalid and will be discarded`;
  }

  static buildSystem(language = 'en', framework = '', rulebookRules = ''): string {
    const langInstruction =
      language !== 'en'
        ? `\n\nIMPORTANT: Write code comments in ${getLanguageName(language)} when adding new comments.`
        : '';

    // Prefer rulebook (from project analysis) over generic framework rules
    const rules = rulebookRules || getFrameworkRules(framework);
    const rulesSection = rules ? `\n${rules}` : '';

    return `You are a senior software engineer implementing code changes.${langInstruction}${rulesSection}

Your job is to implement a specific file change from an approved implementation plan.

CRITICAL RULES:
- Return ONLY the complete new file content as plain text
- Do NOT wrap in markdown code blocks, JSON, or any other format
- Do NOT include any explanation or commentary — only the raw file content
- Follow the existing code style and patterns in the provided context
- Implement ONLY what is described in the step, nothing more
- Ensure the code compiles and follows TypeScript strict mode if applicable
- Never expose secrets, hardcode credentials, or add console.log debugging`;
  }

  static buildUser(
    step: {
      type: 'CREATE' | 'MODIFY' | 'DELETE';
      filePath: string;
      description: string;
    },
    existingContent: string | null,
    context: {
      framework: string;
      language: string;
    },
  ): string {
    return `TASK: ${step.type} file at ${step.filePath}
Description: ${step.description}
Framework: ${context.framework}
Language: ${context.language}

${existingContent ? `EXISTING FILE CONTENT:\n${existingContent}` : 'This is a new file to create.'}

Return ONLY the complete new file content as plain text. No markdown, no code blocks, no explanation.`;
  }

  /**
   * Phase 1 of the two-phase fix loop: diagnose the build error before touching any code.
   * The AI classifies the error, traces the stack, and identifies the exact root-cause file(s).
   */
  static buildDiagnose(
    buildErrors: string[],
    repoFileTree: string[],
    context: { framework: string; language: string },
    fullBuildOutput?: string,
  ): string {
    const errorSection = buildErrors.length > 0
      ? buildErrors.join('\n')
      : '(see full build output below)';

    const fullOutputSection = fullBuildOutput
      ? `\nFULL BUILD OUTPUT:\n${fullBuildOutput.substring(0, 4000)}`
      : '';

    const fileTreeSection = repoFileTree.slice(0, 200).join('\n') || '(not available)';

    return `You are a senior ${context.framework} (${context.language}) engineer diagnosing a build failure.

Your ONLY job right now is to DIAGNOSE — do NOT suggest code changes yet.

BUILD ERRORS:
${errorSection}${fullOutputSection}

REPO FILE TREE:
${fileTreeSection}

INSTRUCTIONS:
1. Classify each error into one of: typescript | eslint | module-resolution | runtime | static-generation | hydration | framework-constraint | other
2. For runtime / static-generation errors: trace the stack top-to-bottom to find the ORIGINAL source module (not just the compiled chunk path)
3. Identify the root-cause file(s) from the REPO FILE TREE above
4. Do NOT assume the file that was previously modified is the cause of the current error
5. For Next.js errors check: App Router vs Pages Router, Server vs Client Component boundaries, "use client" directive, next/document usage, React context/provider boundaries, browser-only APIs during static generation

Return ONLY a JSON object with this shape:
{
  "errorType": "typescript | eslint | module-resolution | runtime | static-generation | hydration | framework-constraint | other",
  "rootCause": "one-sentence explanation of what is actually wrong",
  "affectedFiles": ["list of file paths from the repo tree that need to change — derived from the stack trace, NOT from the previously changed files"],
  "diagnosis": "detailed explanation: why this error happens, what concept is violated, what the fix must address"
}`;
  }

  static buildFix(
    buildErrors: string[],
    allChangedFiles: Array<{ filePath: string; content: string }>,
    repoFileTree: string[],
    context: { framework: string; language: string },
    fullBuildOutput?: string,
    diagnosis?: { errorType: string; rootCause: string; affectedFiles: string[]; diagnosis: string },
    attemptNumber?: number,
    unchangedFiles?: string[],
  ): string {
    const fileContentsSection = allChangedFiles
      .map(f => `=== ${f.filePath} ===\n${f.content}`)
      .join('\n\n');

    const fileTreeSection = repoFileTree.length > 0
      ? repoFileTree.slice(0, 200).join('\n')
      : '(not available)';

    const errorSection = buildErrors.length > 0
      ? buildErrors.join('\n')
      : '(see full build output below)';

    const fullOutputSection = fullBuildOutput
      ? `\nFULL BUILD OUTPUT (for additional context):\n${fullBuildOutput.substring(0, 3000)}`
      : '';

    const diagnosisSection = diagnosis
      ? `\nDIAGNOSIS FROM INVESTIGATION PHASE:
Error type: ${diagnosis.errorType}
Root cause: ${diagnosis.rootCause}
Files identified as root cause: ${diagnosis.affectedFiles.join(', ') || 'see diagnosis below'}
Diagnosis: ${diagnosis.diagnosis}

IMPORTANT: Base your fix on the diagnosis above. Only modify files identified in "affectedFiles" unless the diagnosis explicitly says other files need changes too.`
      : '';

    const attemptSection = (attemptNumber !== undefined && attemptNumber > 1)
      ? `\n⚠️  THIS IS FIX ATTEMPT #${attemptNumber}. The previous ${attemptNumber - 1} attempt(s) failed.
${unchangedFiles && unchangedFiles.length > 0
  ? `CRITICAL: The following files were generated in a previous attempt but PRODUCED IDENTICAL OUTPUT — your previous fix for these files DID NOT resolve the build error:
${unchangedFiles.map(f => `  - ${f}`).join('\n')}
You MUST generate DIFFERENT content for these files. If you return the same content again, the build will fail again.
THINK DIFFERENTLY: The files shown may look correct in isolation, but the error persists — that means your previous approach is fundamentally wrong. Try a completely different strategy:
  - Look for OTHER files not yet modified that may be the real root cause
  - Consider creating a new wrapper/bridge file instead of modifying the existing ones
  - Re-examine ALL imports, re-exports, and provider wrapping in the component tree`
  : 'Your previous fixes did not resolve the error. Try a completely different approach.'}`
      : '';

    return `You are fixing build errors in a ${context.framework} (${context.language}) project.${attemptSection}

CRITICAL FRAMEWORK RULES (apply these regardless of what the error says):
- NEVER import from "next/document" (Html, Head, Main, NextScript) in App Router (src/app/ directory)
- App Router layout.tsx uses plain HTML tags: <html lang="en"><body>{children}</body></html>
- A file with "export const metadata" MUST NOT have "use client"
- "use client" must be the FIRST line before any imports
- Zustand persist requires: import { persist, createJSONStorage } from 'zustand/middleware'
- Zustand hooks (useXxxStore) only in Client Components, never in Server Components
- TypeError: Cannot read properties of null (reading 'useContext') = a hook is called in a Server Component. The component calling useTheme/useContext MUST have "use client" at top, AND must be rendered inside its Provider. Never call context hooks in Server Components or at module-load time.
- If you introduced a ThemeProvider or context: ensure (1) the Provider file has "use client", (2) any component using useContext/useTheme has "use client", (3) layout.tsx does NOT have "use client" — it wraps the Provider as a Server Component

ZUSTAND PERSIST + SSR RULES (this is the most common cause of useContext crash during static generation):
- WRONG: storage: createJSONStorage(() => localStorage)  ← crashes on server where window is undefined
- RIGHT: Guard localStorage access:
    storage: createJSONStorage(() => {
      if (typeof window === 'undefined') return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
      return localStorage;
    }),
    skipHydration: true,
- WRONG: ThemeProvider calls useThemeStore() and renders DOM immediately
- RIGHT: Use mounted guard to prevent hydration mismatch:
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return <>{children}</>;
- For theme flash prevention: put inline <script> directly in layout.tsx (Server Component), NOT in a separate ThemeScript component with "use client"
- Inline script in layout.tsx: <script dangerouslySetInnerHTML={{ __html: \`(function(){var t=localStorage.getItem('theme-storage');try{var p=JSON.parse(t||'{}');if(p.state&&p.state.theme==='light')document.documentElement.classList.remove('dark');else document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();\` }} />
${diagnosisSection}
BUILD ERRORS TO FIX:
${errorSection}${fullOutputSection}

REPO FILE TREE (files that ACTUALLY EXIST):
${fileTreeSection}

ALL SOURCE FILES IN THE REPOSITORY (${allChangedFiles.length} files — complete visibility):
${fileContentsSection}

INSTRUCTIONS:
1. Use the DIAGNOSIS above as your primary guide — fix the root cause, not just the symptom
2. For "Module not found" errors: check the REPO FILE TREE — if the module doesn't exist, CREATE it; if it exists at a different path, fix the import
3. For "use client" errors: add "use client" directive to the correct file
4. For type errors: fix the type in the relevant file
5. If the error is unrelated to the previously changed files, start fresh from the root cause
6. Return a JSON array of ALL files that need to be created or modified:

[
  {
    "filePath": "src/hooks/useTheme.ts",
    "type": "CREATE",
    "content": "complete file content here"
  },
  {
    "filePath": "src/components/ui/card.tsx",
    "type": "MODIFY",
    "content": "complete corrected file content here"
  }
]

RULES:
- Return ONLY the JSON array, no markdown, no explanation
- Include the COMPLETE file content for every file (not just the changed parts)
- Only include files that actually need changes
- Use correct import paths based on the REPO FILE TREE above`;
  }
}
