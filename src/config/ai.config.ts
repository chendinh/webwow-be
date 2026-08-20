import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const aiConfigValidationSchema = Joi.object({
  AI_PROVIDER: Joi.string().valid('openai', 'anthropic').required(),
  OPENAI_API_KEY: Joi.string().optional(),
  ANTHROPIC_API_KEY: Joi.string().optional(),
  AI_DEFAULT_MODEL: Joi.string().default('gpt-4o'),
  AI_PLANNING_MODEL: Joi.string().optional(),
});

export const aiConfig = registerAs('ai', () => ({
  provider: process.env.AI_PROVIDER ?? 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: process.env.AI_DEFAULT_MODEL ?? 'gpt-4o',
  // Model dùng cho các tác vụ planning/analysis — mặc định bằng defaultModel nếu không set
  planningModel: process.env.AI_PLANNING_MODEL ?? process.env.AI_DEFAULT_MODEL ?? 'gpt-4o',
}));

export type AiConfig = ReturnType<typeof aiConfig>;
