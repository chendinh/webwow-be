import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { AI_PROVIDER, IAIProvider } from '../providers/ai-provider.interface';
import { CodingPrompt } from '../prompts/coding.prompt';
import { ImplementationPlan, ImplementationStep } from '../schemas/implementation-plan.schema';

export interface CodeChange {
  filePath: string;
  content: string;  // empty string for DELETE
  type: 'CREATE' | 'MODIFY' | 'DELETE';
}

@Injectable()
export class CodingAgent {
  private readonly logger = new Logger(CodingAgent.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {}

  /**
   * Implement a single file step from the ImplementationPlan.
   * Only generates code for the specific file — does NOT touch sandbox.
   * Requirements: R11.2
   */
  async implementStep(
    step: ImplementationStep,
    existingContent: string | null,
    context: { framework: string; language: string },
  ): Promise<CodeChange> {
    if (step.type === 'DELETE') {
      return { filePath: step.filePath, content: '', type: 'DELETE' };
    }

    const systemPrompt = CodingPrompt.buildSystem();
    const userPrompt = CodingPrompt.buildUser(step, existingContent, context);

    this.logger.log(`Implementing ${step.type} for: ${step.filePath}`);

    const response = await this.aiProvider.call<string>(systemPrompt, userPrompt, {
      maxTokens: 4096,
      temperature: 0.1,
    });

    this.logger.log(
      `Code generated for ${step.filePath}: ${response.inputTokens + response.outputTokens} tokens`,
    );

    // Response is raw file content as string (not JSON object)
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      filePath: step.filePath,
      content,
      type: step.type,
    };
  }

  /**
   * Generate a Conventional Commits message for the changes.
   */
  generateCommitMessage(plan: ImplementationPlan): string {
    const type = plan.complexityLevel === 'CRITICAL' ? 'feat!' : 'feat';
    const scope = plan.steps[0]?.filePath.split('/')[1] ?? 'app';
    const subject = plan.summary.slice(0, 72).replace(/\n/g, ' ');
    return `${type}(${scope}): ${subject}`;
  }
}
