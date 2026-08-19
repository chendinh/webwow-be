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
        ? `\n\nIMPORTANT: Write ALL text fields in ${getLanguageName(language)} EXCEPT file paths, function names, and code identifiers. This includes aiDiagnosis, plainDiagnosis, feasibilityNotes, option titles, descriptions, pros, cons, and clarifyingQuestions.`
        : '';

    return `You are a senior software engineer AND a product consultant analyzing a customer request.${langInstruction}

The customer may NOT be a developer. Your job is to:
1. Understand what they actually want (translate business language → technical spec)
2. Identify which files need to change based on the ACTUAL file tree provided
3. Generate 2-3 concrete implementation options they can choose from
4. Explain everything in TWO ways: technical (for devs) AND plain language (for non-devs)
5. Ask clarifying questions if the request is ambiguous

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NEVER include markdown code blocks in your response
- ONLY reference files that actually exist in the PROJECT CONTEXT provided
- NEVER fabricate file names, function names, or module names
- If you cannot identify specific files, return an empty affectedFiles array
- Always provide both "aiDiagnosis" (technical) AND "plainDiagnosis" (jargon-free)
- implementationOptions MUST have 2-3 distinct approaches when there are meaningful trade-offs
- Each option must have a "plainTitle" and "plainDescription" a non-developer can understand`;
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
      directoryStructure?: {
        fileTree?: string[];
        readmeSnippet?: string | null;
        [key: string]: unknown;
      } | null;
    },
  ): string {
    const fileTree = projectContext.directoryStructure?.fileTree;
    const fileTreeSection = fileTree && fileTree.length > 0
      ? `\nREPO FILE TREE (actual files — use ONLY these paths):\n${fileTree.slice(0, 300).join('\n')}`
      : '\nREPO FILE TREE: Not available — do NOT fabricate file paths.';

    const readmeSnippet = projectContext.directoryStructure?.readmeSnippet;
    const readmeSection = readmeSnippet
      ? `\nREADME EXCERPT:\n${readmeSnippet}`
      : '';

    return `PROJECT CONTEXT:
Language: ${projectContext.primaryLanguage ?? 'unknown'}
Frameworks: ${projectContext.frameworks.join(', ') || 'none detected'}
Detected modules: ${JSON.stringify(projectContext.detectedModules)}
Main dependencies: ${JSON.stringify(projectContext.mainDependencies)}${fileTreeSection}${readmeSection}

CUSTOMER REQUEST:
Title: ${issue.title}
Description: ${issue.description}
Type: ${issue.type}
Priority: ${issue.priority}

Return JSON matching this schema exactly:
{
  "affectedFiles": string[],
  "aiDiagnosis": string,           // technical explanation with file paths
  "plainDiagnosis": string,        // same info but NO jargon — explain like to a business owner
  "riskLevel": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "complexity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "feasibilityNotes": string,
  "estimatedTokens": number,
  "relatedModules": string[],
  "implementationOptions": [       // 2-3 distinct ways to implement this
    {
      "id": "option_a",
      "title": string,             // short technical title
      "plainTitle": string,        // non-technical title e.g. "Nút chuyển đổi trên thanh menu"
      "description": string,       // technical details
      "plainDescription": string,  // explain in plain language what this looks like/feels like for users
      "pros": string[],            // benefits in plain language
      "cons": string[],            // drawbacks in plain language
      "complexity": "LOW"|"MEDIUM"|"HIGH",
      "estimatedMinutes": number,
      "affectedFiles": string[],   // ONLY files from the FILE TREE above
      "recommended": boolean       // true for the best balanced option
    }
  ],
  "clarifyingQuestions": string[]  // questions to ask if the request needs more detail (max 2, can be empty [])
}`;
  }
}
