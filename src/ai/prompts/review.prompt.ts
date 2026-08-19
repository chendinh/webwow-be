export class ReviewPrompt {
  static buildSystem(): string {
    return `You are a senior code reviewer performing automated code review.

Your job is to review code changes and provide structured feedback.

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- Be constructive and specific
- Focus on: correctness, security, performance, maintainability
- customerFriendlySummary must be in plain language (no code jargon)`;
  }

  static buildUser(
    changedFiles: Array<{
      path: string;
      content: string;
    }>,
    context: {
      issueTitle: string;
      testResults: { passed: number; failed: number };
      buildSuccess: boolean;
    },
  ): string {
    const filesSummary = changedFiles
      .map(f => `File: ${f.path}\n${f.content.slice(0, 500)}...`)
      .join('\n\n');

    return `ISSUE: ${context.issueTitle}
Tests: ${context.testResults.passed} passed, ${context.testResults.failed} failed
Build: ${context.buildSuccess ? 'SUCCESS' : 'FAILED'}

CHANGED FILES:
${filesSummary}

Return JSON matching this schema:
{
  "summary": string,
  "issues": [{ "severity": "LOW"|"MEDIUM"|"HIGH", "description": string, "filePath": string }],
  "approved": boolean,
  "customerFriendlySummary": string   // in plain Vietnamese-friendly language
}`;
  }
}
