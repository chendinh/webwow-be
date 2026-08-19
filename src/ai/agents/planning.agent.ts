import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { PlanningPrompt } from '../prompts/planning.prompt';
import { ImplementationPlanSchema, ImplementationPlan } from '../schemas/implementation-plan.schema';
import { AnalysisResult } from '../schemas/analysis-result.schema';

export interface PlanningAgentResult {
  result: ImplementationPlan;
  tokensUsed: number;
  costUsd: number;
}

@Injectable()
export class PlanningAgent {
  private readonly logger = new Logger(PlanningAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {}

  async plan(
    issue: {
      title: string;
      description: string;
      type: string;
    },
    analysisResult: AnalysisResult,
    language = 'en',
  ): Promise<PlanningAgentResult> {
    const systemPrompt = PlanningPrompt.buildSystem(language);
    const userPrompt = PlanningPrompt.buildUser(issue, analysisResult);

    this.logger.log(`Creating implementation plan for: ${issue.title}`);

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      maxTokens: 3000,
      temperature: 0.1,
    });

    const tokensUsed = response.inputTokens + response.outputTokens;
    const costUsd = response.estimatedCostUsd;

    this.logger.log(
      `Planning complete: ${tokensUsed} tokens, $${costUsd.toFixed(4)}`,
    );

    try {
      const result = ImplementationPlanSchema.parse(response.content);
      return { result, tokensUsed, costUsd };
    } catch (err) {
      if (err instanceof ZodError) {
        this.logger.error(`Planning response validation failed: ${err.message}`);
        throw new Error(`AI lập kế hoạch trả về kết quả không hợp lệ: ${err.issues.map(i => i.message).join(', ')}`);
      }
      throw err;
    }
  }
}
