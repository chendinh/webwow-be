import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';

import {
  appConfig,
  databaseConfig,
  jwtConfig,
  aiConfig,
  githubConfig,
  redisConfig,
  emailConfig,
} from './config';
import { AuthModule } from './modules/auth/auth.module';
import { GithubModule } from './modules/github/github.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { QueueModule } from './queue/queue.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ActivityModule } from './modules/activity/activity.module';
import { IssuesModule } from './modules/issues/issues.module';
import { AiCoreModule } from './ai/ai.module';
import { UsageModule } from './modules/usage/usage.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AITasksModule } from './modules/ai-tasks/ai-tasks.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { SystemHealthModule } from './modules/system-health/system-health.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        aiConfig,
        githubConfig,
        redisConfig,
        emailConfig,
      ],
      validationSchema: Joi.object({
        // App
        PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        FRONTEND_URL: Joi.string().default('http://localhost:3001'),

        // Database
        DATABASE_URL: Joi.string().required(),

        // JWT
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().required(),
        JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRY: Joi.string().default('7d'),

        // AI
        AI_PROVIDER: Joi.string().valid('openai', 'anthropic').required(),
        OPENAI_API_KEY: Joi.string().optional(),
        ANTHROPIC_API_KEY: Joi.string().optional(),
        AI_DEFAULT_MODEL: Joi.string().default('gpt-4o'),

        // GitHub
        GITHUB_APP_ID: Joi.string().required(),
        GITHUB_APP_PRIVATE_KEY: Joi.string().required(),
        GITHUB_WEBHOOK_SECRET: Joi.string().required(),
        ENCRYPTION_KEY: Joi.string().required(),

        // Redis
        REDIS_URL: Joi.string().default('redis://localhost:6379'),

        // Email
        EMAIL_PROVIDER: Joi.string().valid('resend', 'smtp').default('resend'),
        RESEND_API_KEY: Joi.string().optional(),
        EMAIL_FROM: Joi.string().default('noreply@platform.com'),

        // Sandbox limits (optional, used by workers)
        MAX_CONCURRENT_CODING_TASKS: Joi.number().default(5),
        SANDBOX_CPU_LIMIT: Joi.number().default(2),
        SANDBOX_MEMORY_LIMIT: Joi.string().default('4g'),
        SANDBOX_DISK_LIMIT: Joi.string().default('10g'),
        SANDBOX_TIMEOUT_MINUTES: Joi.number().default(30),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Rate limiting — guards @Throttle decorated endpoints (e.g. login brute-force protection)
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute window (ms)
        limit: 100, // default global limit; per-endpoint limits override via @Throttle
      },
    ]),

    NotificationsModule,
    AuthModule,
    OrganizationsModule,
    GithubModule,
    ProjectsModule,
    PricingModule,
    QueueModule,
    ActivityModule,
    AiCoreModule.register(),
    IssuesModule,
    UsageModule,
    SandboxModule,
    AITasksModule,
    ApprovalsModule,
    SystemHealthModule,
    KnowledgeModule,
  ],
})
export class AppModule {}
