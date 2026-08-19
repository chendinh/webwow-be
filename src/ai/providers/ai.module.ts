import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER, IAIProvider } from './ai-provider.interface';
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';

@Module({})
export class AiModule {
  static register(): DynamicModule {
    return {
      module: AiModule,
      imports: [],
      providers: [
        OpenAiProvider,
        AnthropicProvider,
        {
          provide: AI_PROVIDER,
          inject: [ConfigService, OpenAiProvider, AnthropicProvider],
          useFactory: (
            config: ConfigService,
            openai: OpenAiProvider,
            anthropic: AnthropicProvider,
          ): IAIProvider => {
            const provider = config.get<string>('ai.provider', 'openai');
            return provider === 'anthropic' ? anthropic : openai;
          },
        },
      ],
      exports: [AI_PROVIDER],
    };
  }
}
