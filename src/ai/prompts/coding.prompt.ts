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

export class CodingPrompt {
  static buildSystem(language = 'en'): string {
    const langInstruction =
      language !== 'en'
        ? `\n\nIMPORTANT: Write code comments in ${getLanguageName(language)} when adding new comments.`
        : '';

    return `You are a senior software engineer implementing code changes.${langInstruction}

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
