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

    return `You are a senior software architect creating a detailed implementation plan.${langInstruction}

Your job is to create a precise, ordered list of code changes to implement the analyzed issue.

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NEVER include markdown code blocks in your response
- ONLY include files identified in the analysis phase
- Each step must be atomic and independently verifiable
- Include rollback notes for risky changes
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
  ): string {
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

Create an ImplementationPlan and return JSON matching this schema:
{
  "summary": string,               // one paragraph summary in customer-friendly language
  "steps": [
    {
      "order": number,
      "type": "CREATE"|"MODIFY"|"DELETE",
      "filePath": string,
      "description": string,
      "testRequired": boolean,
      "rollbackNote": string        // optional
    }
  ],
  "testsToWrite": string[],        // list of test descriptions
  "rollbackStrategy": string,
  "estimatedMinutes": number,
  "complexityLevel": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "estimatedTokens": number
}`;
  }
}
