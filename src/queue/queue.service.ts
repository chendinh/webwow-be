import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { QUEUES } from './queue.constants';
import {
  AIAnalysisJobData,
  AICodingJobData,
  NotificationJobData,
  PRCreationJobData,
  ProjectAnalysisJobData,
} from './queue.types';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUES.PROJECT_ANALYSIS)
    private readonly projectAnalysisQueue: Queue,
    @InjectQueue(QUEUES.AI_ANALYSIS)
    private readonly aiAnalysisQueue: Queue,
    @InjectQueue(QUEUES.AI_CODING)
    private readonly aiCodingQueue: Queue,
    @InjectQueue(QUEUES.PR_CREATION)
    private readonly prCreationQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATION)
    private readonly notificationQueue: Queue,
  ) {}

  // Default job options: exponential backoff — 30s → 120s → 600s, max 3 attempts
  private readonly defaultOptions = {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 30_000, // Initial delay 30 seconds
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  };

  async enqueueProjectAnalysis(data: ProjectAnalysisJobData): Promise<string> {
    const job = await this.projectAnalysisQueue.add(
      QUEUES.PROJECT_ANALYSIS,
      data,
      this.defaultOptions,
    );
    return job.id as string;
  }

  async enqueueAIAnalysis(data: AIAnalysisJobData): Promise<string> {
    const job = await this.aiAnalysisQueue.add(
      QUEUES.AI_ANALYSIS,
      data,
      this.defaultOptions,
    );
    return job.id as string;
  }

  // AI_CODING concurrency limited to 5 (enforced in the @Processor decorator on the worker)
  // Only 1 attempt — worker handles its own retry logic internally
  async enqueueAICoding(data: AICodingJobData): Promise<string> {
    const job = await this.aiCodingQueue.add(
      QUEUES.AI_CODING,
      data,
      { ...this.defaultOptions, attempts: 1 },
    );
    return job.id as string;
  }

  async enqueuePRCreation(data: PRCreationJobData): Promise<string> {
    const job = await this.prCreationQueue.add(
      QUEUES.PR_CREATION,
      data,
      this.defaultOptions,
    );
    return job.id as string;
  }

  async enqueueNotification(data: NotificationJobData): Promise<string> {
    const job = await this.notificationQueue.add(
      QUEUES.NOTIFICATION,
      data,
      this.defaultOptions,
    );
    return job.id as string;
  }
}
