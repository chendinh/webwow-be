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

export class PlanningPrompt {
  static buildSystem(language = 'en'): string {
    const langInstruction =
      language !== 'en'
        ? `\n\nIMPORTANT: Write all descriptive text fields (summary, step descriptions, testsToWrite descriptions, rollbackStrategy) in ${getLanguageName(language)}. Keep file paths, code snippets, and technical identifiers in English.`
        : '';

    return `You are a senior software architect creating a precise implementation plan based on ACTUAL source code.${langInstruction}

Your job is to create a specific, ordered list of code changes grounded in the real codebase.

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NEVER include markdown code blocks in your response
- ONLY reference files that appear in the AFFECTED FILES or FILE CONTENTS sections
- Your step descriptions MUST reference actual function names, component names, class names, and patterns seen in the provided source code
- Each step must be atomic, specific, and independently verifiable
- Do NOT invent patterns, file structures, or APIs that aren't visible in the provided code
- Estimate tokens honestly for implementation`;
  }

  static buildUser(
    issue: {
      title: string;
      description: string;
      type: string;
    },
    analysisResult: {
      affectedFiles: string[];
      aiDiagnosis: string;
      complexity: string;
      riskLevel: string;
      feasibilityNotes: string;
    },
    /** Actual source code content of affected files — keyed by file path */
    fileContents: Record<string, string> = {},
  ): string {
    // Build the file contents section
    const fileContentsSection = Object.keys(fileContents).length > 0
      ? '\n\n' + Object.entries(fileContents)
          .map(([path, content]) => `=== FILE: ${path} ===\n${content}`)
          .join('\n\n')
      : '\n\nFILE CONTENTS: Not available — base your plan only on the file paths listed above.';

    return `ISSUE TO IMPLEMENT:
Title: ${issue.title}
Description: ${issue.description}
Type: ${issue.type}

ANALYSIS RESULT:
Diagnosis: ${analysisResult.aiDiagnosis}
Affected files: ${analysisResult.affectedFiles.join(', ')}
Complexity: ${analysisResult.complexity}
Risk: ${analysisResult.riskLevel}
Feasibility: ${analysisResult.feasibilityNotes}

ACTUAL SOURCE CODE OF AFFECTED FILES:${fileContentsSection}

Based on the ACTUAL SOURCE CODE above, create a precise ImplementationPlan.
Your step descriptions must reference real function names, component names, and patterns from the code.
IMPORTANT: Every "filePath" must be a complete file path including filename and extension (e.g. "src/components/layout/topbar.tsx"). NEVER use a directory path (no trailing slashes, no paths that end without a file extension).
Return JSON matching this schema:
{
  "summary": string,               // one paragraph summary referencing actual code structure
  "steps": [
    {
      "order": number,
      "type": "CREATE"|"MODIFY"|"DELETE",
      "filePath": string,          // REQUIRED: full file path with extension e.g. "src/components/layout/topbar.tsx" — never a directory
      "description": string,       // MUST reference actual function/component names from the file content
      "testRequired": boolean,
      "rollbackNote": string        // optional
    }
  ],
  "testsToWrite": string[],        // specific test descriptions based on actual code
  "rollbackStrategy": string,
  "estimatedMinutes": number,
  "complexityLevel": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "estimatedTokens": number
}`;
  }
}
