import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const redisConfigValidationSchema = Joi.object({
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
});

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}));

export type RedisConfig = ReturnType<typeof redisConfig>;
