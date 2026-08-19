import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AICallOptions, AIResponse, IAIProvider } from './ai-provider.interface';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

@Injectable()
export class AnthropicProvider implements IAIProvider {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AnthropicProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropicApiKey'),
    });
  }

  getProviderName(): string {
    return 'anthropic';
  }

  async call<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: AICallOptions,
  ): Promise<AIResponse<T>> {
    const model = options?.model
      ?? this.configService.get<string>('ai.defaultModel')
      ?? 'claude-sonnet-4-5';
    const maxTokens = options?.maxTokens ?? 4096;
    const temperature = options?.temperature ?? 0.2;

    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const rawContent =
          response.content[0]?.type === 'text'
            ? response.content[0].text
            : '{}';

        // Strip markdown code blocks that Claude often wraps responses in
        const stripped = rawContent
          .replace(/^```(?:json|typescript|tsx?|jsx?|css|html|ya?ml|sh|bash)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();

        // Try JSON parse; if it fails, return as raw string (used by CodingAgent for file content)
        let content: T;
        try {
          content = JSON.parse(stripped) as T;
        } catch {
          content = stripped as unknown as T;
        }

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        // Claude-3 pricing: $3 / 1M input, $15 / 1M output
        const estimatedCostUsd =
          inputTokens * 0.000003 + outputTokens * 0.000015;

        return {
          content,
          inputTokens,
          outputTokens,
          model: response.model,
          estimatedCostUsd,
        };
      } catch (error: unknown) {
        lastError = error;
        const isRateLimit =
          error instanceof Anthropic.APIError && error.status === 429;

        if (isRateLimit && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          this.logger.warn(
            `Anthropic rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
          );
          await sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
