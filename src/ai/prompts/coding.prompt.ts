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
7. "use client" must be the FIRST line of the file (before any imports)`,

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

  static buildFix(
    buildErrors: string[],
    allChangedFiles: Array<{ filePath: string; content: string }>,
    repoFileTree: string[],
    context: { framework: string; language: string },
    fullBuildOutput?: string,
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

    return `You are fixing build errors in a ${context.framework} (${context.language}) project.

CRITICAL FRAMEWORK RULES (apply these regardless of what the error says):
- NEVER import from "next/document" (Html, Head, Main, NextScript) in App Router (src/app/ directory)
- App Router layout.tsx uses plain HTML tags: <html lang="en"><body>{children}</body></html>
- A file with "export const metadata" MUST NOT have "use client"
- "use client" must be the FIRST line before any imports
- Zustand persist requires: import { persist, createJSONStorage } from 'zustand/middleware'
- Zustand hooks (useXxxStore) only in Client Components, never in Server Components

BUILD ERRORS TO FIX:
${errorSection}${fullOutputSection}

REPO FILE TREE (files that ACTUALLY EXIST):
${fileTreeSection}

CURRENT CONTENT OF ALL CHANGED FILES:
${fileContentsSection}

INSTRUCTIONS:
1. Analyze ALL errors above together
2. For "Module not found" errors: check the REPO FILE TREE — if the module doesn't exist, CREATE it; if it exists at a different path, fix the import
3. For "use client" errors: add "use client" directive to the correct file
4. For type errors: fix the type in the relevant file
5. Return a JSON array of ALL files that need to be created or modified:

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
