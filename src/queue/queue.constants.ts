export const QUEUES = {
  PROJECT_ANALYSIS: 'project-analysis',
  AI_ANALYSIS: 'ai-analysis',
  AI_CODING: 'ai-coding',
  PR_CREATION: 'pr-creation',
  NOTIFICATION: 'notification',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const CONCURRENCY = {
  PROJECT_ANALYSIS: 3,
  AI_ANALYSIS: 5,
  AI_CODING: 5, // Max 5 concurrent coding tasks (R19.4)
  PR_CREATION: 10,
  NOTIFICATION: 10,
} as const;
