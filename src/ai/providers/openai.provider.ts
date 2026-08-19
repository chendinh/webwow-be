import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AICallOptions, AIResponse, IAIProvider } from './ai-provider.interface';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

@Injectable()
export class OpenAiProvider implements IAIProvider {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('ai.openaiApiKey'),
    });
  }

  getProviderName(): string {
    return 'openai';
  }

  async call<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: AICallOptions,
  ): Promise<AIResponse<T>> {
    const model =
      options?.model ?? this.configService.get<string>('ai.defaultModel', 'gpt-4o');
    const maxTokens = options?.maxTokens ?? 4096;
    const temperature = options?.temperature ?? 0.2;

    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const rawContent = completion.choices[0]?.message?.content ?? '{}';

        // Strip markdown code blocks if present (e.g., ```json ... ``` or ``` ... ```)
        const stripped = rawContent
          .replace(/^```(?:json|typescript|tsx?|jsx?|css|html|ya?ml|sh|bash)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();

        // Try JSON parse; if it fails, return raw string as content
        let content: T;
        try {
          content = JSON.parse(stripped) as T;
        } catch {
          // Not JSON — return as raw string (used by CodingAgent for file content)
          content = stripped as unknown as T;
        }

        const inputTokens = completion.usage?.prompt_tokens ?? 0;
        const outputTokens = completion.usage?.completion_tokens ?? 0;
        // GPT-4o pricing: $5 / 1M input, $15 / 1M output
        const estimatedCostUsd =
          inputTokens * 0.000005 + outputTokens * 0.000015;

        return {
          content,
          inputTokens,
          outputTokens,
          model: completion.model,
          estimatedCostUsd,
        };
      } catch (error: unknown) {
        lastError = error;
        const isRateLimit =
          error instanceof OpenAI.APIError && error.status === 429;

        if (isRateLimit && attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          this.logger.warn(
            `OpenAI rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
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
