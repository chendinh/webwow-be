import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FailurePattern {
  errorSignature: string;
  framework: string;
  rootCause: string;
  successfulFix: string;  // what actually worked
  failedAttempts: string[]; // what didn't work
  occurrences: number;
}

@Injectable()
export class FailureLearnerService {
  private readonly logger = new Logger(FailureLearnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a failed fix attempt so we can learn from it
   */
  async recordFailure(params: {
    taskId: string;
    organizationId: string;
    errorSignature: string;
    framework: string;
    attemptedFix: string;  // description of what was tried
    buildOutput: string;
    affectedFiles: string[];
  }): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          organizationId: params.organizationId,
          taskId: params.taskId,
          eventType: 'ERROR',
          friendlyMessage: `AI fix attempt failed: ${params.errorSignature.substring(0, 200)}`,
          technicalDetail: {
            type: 'FAILURE_PATTERN',
            errorSignature: params.errorSignature,
            framework: params.framework,
            attemptedFix: params.attemptedFix,
            buildOutput: params.buildOutput.substring(0, 2000),
            affectedFiles: params.affectedFiles,
          },
          actorId: 'system',
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record failure pattern: ${String(err)}`);
    }
  }

  /**
   * Record a successful fix so we can reuse this pattern
   */
  async recordSuccess(params: {
    taskId: string;
    organizationId: string;
    errorSignature: string;
    framework: string;
    successfulFix: string;
    filesFixed: string[];
    attemptsNeeded: number;
  }): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          organizationId: params.organizationId,
          taskId: params.taskId,
          eventType: 'TEST_RESULT',
          friendlyMessage: `AI fix succeeded after ${params.attemptsNeeded} attempt(s): ${params.errorSignature.substring(0, 100)}`,
          technicalDetail: {
            type: 'SUCCESS_PATTERN',
            errorSignature: params.errorSignature,
            framework: params.framework,
            successfulFix: params.successfulFix,
            filesFixed: params.filesFixed,
            attemptsNeeded: params.attemptsNeeded,
          },
          actorId: 'system',
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record success pattern: ${String(err)}`);
    }
  }

  /**
   * Get known solutions for similar error signatures.
   * Used to inject into fix prompts: "we've seen this before, here's what worked"
   */
  async getKnownSolutions(errorSignature: string, framework: string): Promise<string[]> {
    try {
      const logs = await this.prisma.activityLog.findMany({
        where: {
          eventType: 'TEST_RESULT',
          technicalDetail: { not: undefined },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const solutions: string[] = [];
      for (const log of logs) {
        const detail = log.technicalDetail as Record<string, unknown> | null;
        if (!detail || detail['type'] !== 'SUCCESS_PATTERN') continue;
        if (detail['framework'] !== framework) continue;
        const sig = (detail['errorSignature'] as string) ?? '';
        // Fuzzy match: same error type
        const sigType = errorSignature.split(':')[0]?.toLowerCase();
        if (sigType && sig.toLowerCase().includes(sigType)) {
          solutions.push((detail['successfulFix'] as string) ?? '');
        }
      }

      return solutions.filter(Boolean).slice(0, 3);
    } catch {
      return [];
    }
  }
}
