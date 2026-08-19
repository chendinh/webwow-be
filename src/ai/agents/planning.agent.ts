import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { PlanningPrompt } from '../prompts/planning.prompt';
import { ImplementationPlanSchema, ImplementationPlan } from '../schemas/implementation-plan.schema';
import { AnalysisResult } from '../schemas/analysis-result.schema';

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
  ): Promise<ImplementationPlan> {
    const systemPrompt = PlanningPrompt.buildSystem();
    const userPrompt = PlanningPrompt.buildUser(issue, analysisResult);

    this.logger.log(`Creating implementation plan for: ${issue.title}`);

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      maxTokens: 3000,
      temperature: 0.1,
    });

    this.logger.log(
      `Planning complete: ${response.inputTokens + response.outputTokens} tokens, $${response.estimatedCostUsd.toFixed(4)}`,
    );

    try {
      const result = ImplementationPlanSchema.parse(response.content);
      return result;
    } catch (err) {
      if (err instanceof ZodError) {
        this.logger.error(`Planning response validation failed: ${err.message}`);
        throw new Error(`AI lập kế hoạch trả về kết quả không hợp lệ: ${err.issues.map(i => i.message).join(', ')}`);
      }
      throw err;
    }
  }
}
