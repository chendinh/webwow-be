import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const emailConfigValidationSchema = Joi.object({
  EMAIL_PROVIDER: Joi.string().valid('resend', 'smtp').default('resend'),
  RESEND_API_KEY: Joi.string().optional(),
  EMAIL_FROM: Joi.string().email().default('noreply@platform.com'),
});

export const emailConfig = registerAs('email', () => ({
  provider: process.env.EMAIL_PROVIDER ?? 'resend',
  resendApiKey: process.env.RESEND_API_KEY,
  from: process.env.EMAIL_FROM ?? 'noreply@platform.com',
}));

export type EmailConfig = ReturnType<typeof emailConfig>;
