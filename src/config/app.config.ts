import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const appConfigValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3001'),
});

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
}));

export type AppConfig = ReturnType<typeof appConfig>;
