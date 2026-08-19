import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { ReviewPrompt } from '../prompts/review.prompt';
import { ReviewResultSchema, ReviewResult } from '../schemas/review-result.schema';

@Injectable()
export class ReviewAgent {
  private readonly logger = new Logger(ReviewAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {}

  async review(
    changedFiles: Array<{ path: string; content: string }>,
    context: {
      issueTitle: string;
      testResults: { passed: number; failed: number };
      buildSuccess: boolean;
    },
  ): Promise<ReviewResult> {
    const systemPrompt = ReviewPrompt.buildSystem();
    const userPrompt = ReviewPrompt.buildUser(changedFiles, context);

    this.logger.log(`Reviewing ${changedFiles.length} changed files`);

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      maxTokens: 2048,
      temperature: 0.1,
    });

    try {
      return ReviewResultSchema.parse(response.content);
    } catch (err) {
      if (err instanceof ZodError) {
        this.logger.error(`Review response validation failed: ${err.message}`);
        throw new Error(`AI review trả về kết quả không hợp lệ.`);
      }
      throw err;
    }
  }
}
