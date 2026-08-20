import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { QUEUES } from './queue.constants';
import { QueueService } from './queue.service';
import { ProjectAnalysisWorker } from './workers/project-analysis.worker';
import { AIAnalysisWorker } from './workers/ai-analysis.worker';
import { AICodingWorker } from './workers/ai-coding.worker';
import { PRCreationWorker } from './workers/pr-creation.worker';
import { HealthCheckWorker } from './workers/health-check.worker';
import { KnowledgeAnalysisWorker } from './workers/knowledge-analysis.worker';
import { ProjectsModule } from '../modules/projects/projects.module';
import { ActivityModule } from '../modules/activity/activity.module';
import { GithubModule } from '../modules/github/github.module';
import { AiCoreModule } from '../ai/ai.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { AITasksModule } from '../modules/ai-tasks/ai-tasks.module';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        const isTls = redisUrl.startsWith('rediss://');
        return {
          connection: {
            url: redisUrl,
            ...(isTls ? {
              tls: {
                rejectUnauthorized: false,
              },
            } : {}),
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUES.PROJECT_ANALYSIS },
      { name: QUEUES.AI_ANALYSIS },
      { name: QUEUES.AI_CODING },
      { name: QUEUES.PR_CREATION },
      { name: QUEUES.NOTIFICATION },
      { name: QUEUES.HEALTH_CHECK },
      { name: QUEUES.KNOWLEDGE_ANALYSIS },
    ),
    forwardRef(() => ProjectsModule),
    GithubModule,
    AiCoreModule.register(),
    PricingModule,
    forwardRef(() => AITasksModule),
    ActivityModule,
    KnowledgeModule,
  ],
  providers: [QueueService, ProjectAnalysisWorker, AIAnalysisWorker, AICodingWorker, PRCreationWorker, HealthCheckWorker, KnowledgeAnalysisWorker],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
