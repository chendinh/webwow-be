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

export class IssueAnalysisPrompt {
  static buildSystem(language = 'en'): string {
    const langInstruction =
      language !== 'en'
        ? `\n\nIMPORTANT: Write all text fields (aiDiagnosis, feasibilityNotes) in ${getLanguageName(language)}. Keep technical terms (file paths, function names, code) in English.`
        : '';

    return `You are a senior software engineer analyzing a customer issue request for an existing codebase.${langInstruction}

Your job is to:
1. Understand the customer's request (written in natural language, possibly Vietnamese)
2. Identify which files in the codebase need to change
3. Assess feasibility and estimate complexity
4. Identify technical risks

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NEVER include markdown code blocks in your response
- ONLY reference files that actually exist in the PROJECT CONTEXT provided
- NEVER fabricate file names, function names, or module names
- If you cannot identify specific files, return an empty affectedFiles array
- Assess complexity honestly: LOW = trivial change, MEDIUM = moderate refactoring, HIGH = significant architecture change, CRITICAL = risky breaking change`;
  }

  static buildUser(
    issue: {
      title: string;
      description: string;
      type: string;
      priority: string;
    },
    projectContext: {
      primaryLanguage: string | null;
      frameworks: string[];
      detectedModules: unknown[];
      mainDependencies: unknown[];
      buildScripts: unknown | null;
    },
  ): string {
    return `PROJECT CONTEXT:
Language: ${projectContext.primaryLanguage ?? 'unknown'}
Frameworks: ${projectContext.frameworks.join(', ') || 'none detected'}
Detected modules: ${JSON.stringify(projectContext.detectedModules)}
Main dependencies: ${JSON.stringify(projectContext.mainDependencies)}

CUSTOMER REQUEST:
Title: ${issue.title}
Description: ${issue.description}
Type: ${issue.type}
Priority: ${issue.priority}

Analyze this request and return JSON matching this schema:
{
  "affectedFiles": string[],       // files that need to change (only existing files)
  "aiDiagnosis": string,           // clear technical explanation
  "riskLevel": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "complexity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "feasibilityNotes": string,      // can AI implement this? what are the challenges?
  "estimatedTokens": number,       // rough estimate for implementation
  "relatedModules": string[]       // module names involved
}`;
  }
}
