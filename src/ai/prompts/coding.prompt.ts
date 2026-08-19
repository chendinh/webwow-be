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
}
