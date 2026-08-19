import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const jwtConfigValidationSchema = Joi.object({
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),
});

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessExpiry: process.env.JWT_ACCESS_EXPIRY ?? '15m',
  refreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
}));

export type JwtConfig = ReturnType<typeof jwtConfig>;
