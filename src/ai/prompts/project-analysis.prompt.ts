export class ProjectAnalysisPrompt {
  static buildSystem(): string {
    return `You are a senior software architect analyzing a codebase.
Your job is to analyze the project structure and identify:
1. Primary programming language and frameworks
2. Database and infrastructure dependencies
3. Build tools and CI/CD setup
4. Code quality indicators (tests, type safety, documentation)
5. Potential AI compatibility issues

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NEVER include markdown code blocks in your response
- Only report what you can actually detect from the provided information
- Do NOT fabricate file names, dependencies, or capabilities`;
  }

  static buildUser(repoSummary: {
    name: string;
    packageJson?: Record<string, unknown> | null;
    hasTsconfig: boolean;
    hasDockerfile: boolean;
    hasCi: boolean;
    readmeSnippet?: string | null;
  }): string {
    return `Analyze this repository and return a JSON object:

Repository: ${repoSummary.name}
Has TypeScript config: ${repoSummary.hasTsconfig}
Has Dockerfile: ${repoSummary.hasDockerfile}
Has CI config: ${repoSummary.hasCi}

Package.json excerpt:
${JSON.stringify(repoSummary.packageJson ?? {}, null, 2)}

${repoSummary.readmeSnippet ? `README excerpt:\n${repoSummary.readmeSnippet}` : ''}

Return JSON with: { primaryLanguage, frameworks, databases, buildTools, packageManager, testingSetup, notes }`;
  }
}
