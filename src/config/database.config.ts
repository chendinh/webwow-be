import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const databaseConfigValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
});

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
