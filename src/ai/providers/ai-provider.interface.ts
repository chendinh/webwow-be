export interface AICallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse<T> {
  content: T;
  inputTokens: number;
  outputTokens: number;
  model: string;
  estimatedCostUsd: number;
}

export interface IAIProvider {
  call<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: AICallOptions,
  ): Promise<AIResponse<T>>;
  getProviderName(): string;
}

export const AI_PROVIDER = 'AI_PROVIDER';
