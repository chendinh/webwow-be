import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { IssueAnalysisPrompt } from '../prompts/issue-analysis.prompt';
import { AnalysisResultSchema, AnalysisResult } from '../schemas/analysis-result.schema';

@Injectable()
export class AnalysisAgent {
  private readonly logger = new Logger(AnalysisAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {}

  async analyze(
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
  ): Promise<AnalysisResult> {
    const systemPrompt = IssueAnalysisPrompt.buildSystem();
    const userPrompt = IssueAnalysisPrompt.buildUser(issue, projectContext);

    this.logger.log(`Starting analysis for issue: ${issue.title}`);

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      maxTokens: 2048,
      temperature: 0.1,
    });

    this.logger.log(
      `AI analysis complete: ${response.inputTokens + response.outputTokens} tokens, $${response.estimatedCostUsd.toFixed(4)}`,
    );

    // Validate response against Zod schema — throws ZodError if invalid
    try {
      const result = AnalysisResultSchema.parse(response.content);
      return result;
    } catch (err) {
      if (err instanceof ZodError) {
        this.logger.error(`AI analysis response validation failed: ${err.message}`);
        throw new Error(`AI phân tích trả về kết quả không hợp lệ: ${err.issues.map(i => i.message).join(', ')}`);
      }
      throw err;
    }
  }
}
