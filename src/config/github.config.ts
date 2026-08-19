import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const githubConfigValidationSchema = Joi.object({
  GITHUB_APP_ID: Joi.string().required(),
  GITHUB_APP_PRIVATE_KEY: Joi.string().required(),
  GITHUB_WEBHOOK_SECRET: Joi.string().required(),
  ENCRYPTION_KEY: Joi.string().required(),
});

export const githubConfig = registerAs('github', () => ({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
}));

export type GithubConfig = ReturnType<typeof githubConfig>;
