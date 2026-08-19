import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { QUEUES } from './queue.constants';
import { QueueService } from './queue.service';
import { ProjectAnalysisWorker } from './workers/project-analysis.worker';
import { AIAnalysisWorker } from './workers/ai-analysis.worker';
import { AICodingWorker } from './workers/ai-coding.worker';
import { PRCreationWorker } from './workers/pr-creation.worker';
import { ProjectsModule } from '../modules/projects/projects.module';
import { ActivityModule } from '../modules/activity/activity.module';
import { GithubModule } from '../modules/github/github.module';
import { AiCoreModule } from '../ai/ai.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { AITasksModule } from '../modules/ai-tasks/ai-tasks.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('redis.url') ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.PROJECT_ANALYSIS },
      { name: QUEUES.AI_ANALYSIS },
      { name: QUEUES.AI_CODING },
      { name: QUEUES.PR_CREATION },
      { name: QUEUES.NOTIFICATION },
    ),
    ProjectsModule,
    GithubModule,
    AiCoreModule.register(),
    PricingModule,
    AITasksModule,
    ActivityModule,
  ],
  providers: [QueueService, ProjectAnalysisWorker, AIAnalysisWorker, AICodingWorker, PRCreationWorker],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
