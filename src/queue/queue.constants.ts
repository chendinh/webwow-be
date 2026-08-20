export const QUEUES = {
  PROJECT_ANALYSIS: 'project-analysis',
  AI_ANALYSIS: 'ai-analysis',
  AI_CODING: 'ai-coding',
  PR_CREATION: 'pr-creation',
  NOTIFICATION: 'notification',
  HEALTH_CHECK: 'health-check',
  KNOWLEDGE_ANALYSIS: 'knowledge-analysis',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const CONCURRENCY = {
  PROJECT_ANALYSIS: 3,
  AI_ANALYSIS: 5,
  AI_CODING: 5,
  PR_CREATION: 10,
  NOTIFICATION: 10,
  HEALTH_CHECK: 3,
  KNOWLEDGE_ANALYSIS: 3,
} as const;
