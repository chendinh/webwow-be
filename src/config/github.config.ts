import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const githubConfigValidationSchema = Joi.object({
  GITHUB_APP_ID: Joi.string().required(),
  GITHUB_APP_NAME: Joi.string().required(),
  GITHUB_APP_PRIVATE_KEY: Joi.string().required(),
  GITHUB_WEBHOOK_SECRET: Joi.string().required(),
  ENCRYPTION_KEY: Joi.string().required(),
  GITHUB_OAUTH_CLIENT_ID: Joi.string().required(),
  GITHUB_OAUTH_CLIENT_SECRET: Joi.string().required(),
  GITHUB_OAUTH_CALLBACK_URL: Joi.string().uri().optional(),
});

export const githubConfig = registerAs('github', () => ({
  appId: process.env.GITHUB_APP_ID,
  appName: process.env.GITHUB_APP_NAME,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
  oauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  oauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  oauthCallbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL ?? 'http://localhost:3000/auth/github/callback',
}));

export type GithubConfig = ReturnType<typeof githubConfig>;
