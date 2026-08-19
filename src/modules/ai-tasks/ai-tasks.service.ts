import { Injectable, NotFoundException } from '@nestjs/common';
import { AITask, AITaskStatus, ActivityLog } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { StateMachineService } from './state-machine.service';
import { QueueService } from '../../queue/queue.service';

const MSG = {
  TASK_NOT_FOUND: 'Tác vụ AI không tồn tại hoặc bạn không có quyền truy cập.',
} as const;

@Injectable()
export class AITasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
    private readonly activityService: ActivityService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Find all AITasks for an organization (org-scoped).
   * Requirements: R10.1
   */
  async findAll(organizationId: string): Promise<AITask[]> {
    return this.prisma.aITask.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find single AITask by ID (org-scoped).
   * Returns 404 for both "not found" and "wrong org" to prevent enumeration.
   * Requirements: R10.1
   */
  async findById(taskId: string, organizationId: string): Promise<AITask> {
    const task = await this.prisma.aITask.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException(MSG.TASK_NOT_FOUND);
    }

    return task;
  }

  /**
   * Cancel a task — only valid if the task is in a cancellable state.
   * Uses StateMachineService to validate the transition.
   * Requirements: R10.3
   */
  async cancel(taskId: string, organizationId: string): Promise<AITask> {
    const task = await this.findById(taskId, organizationId);

    // Will throw BadRequestException if transition is not allowed
    this.stateMachine.assertValidTransition(task.status, AITaskStatus.CANCELLED);

    const updated = await this.prisma.aITask.update({
      where: { id: taskId },
      data: {
        status: AITaskStatus.CANCELLED,
        failedAt: new Date(),
        failureReason: this.stateMachine.getFailureMessage(AITaskStatus.CANCELLED),
      },
    });

    // Log STATE_CHANGE activity
    await this.activityService.log({
      organizationId,
      projectId: task.projectId,
      issueId: task.issueId,
      taskId,
      eventType: 'STATE_CHANGE',
      friendlyMessage: `Tác vụ AI đã được hủy.`,
      oldStatus: task.status,
      newStatus: AITaskStatus.CANCELLED,
      actorId: 'user',
    });

    return updated;
  }

  /**
   * Get all activity logs for a task (org-scoped).
   * Requirements: R10.4
   */
  async getLogs(taskId: string, organizationId: string): Promise<ActivityLog[]> {
    // Verify task belongs to org (throws 404 if not)
    await this.findById(taskId, organizationId);

    return this.activityService.findByTask(taskId, organizationId);
  }

  /**
   * Internal: transition task to a new status (used by workers).
   * Validates transition via StateMachineService, updates DB, logs ActivityLog.
   * Requirements: R10.2, R10.5
   */
  async transitionStatus(
    taskId: string,
    toStatus: AITaskStatus,
    organizationId: string,
    meta?: { failureReason?: string; currentStep?: string },
  ): Promise<AITask> {
    const task = await this.findById(taskId, organizationId);

    // Will throw BadRequestException if transition is not allowed
    this.stateMachine.assertValidTransition(task.status, toStatus);

    const now = new Date();
    const isTerminal = toStatus === AITaskStatus.COMPLETED ||
      toStatus === AITaskStatus.FAILED ||
      toStatus === AITaskStatus.CANCELLED;

    const updated = await this.prisma.aITask.update({
      where: { id: taskId },
      data: {
        status: toStatus,
        ...(meta?.currentStep !== undefined && { currentStep: meta.currentStep }),
        ...(toStatus === AITaskStatus.COMPLETED && { completedAt: now }),
        ...(toStatus === AITaskStatus.FAILED && {
          failedAt: now,
          failureReason:
            meta?.failureReason ??
            this.stateMachine.getFailureMessage(AITaskStatus.FAILED),
        }),
        ...(toStatus === AITaskStatus.CANCELLED && {
          failedAt: now,
          failureReason:
            meta?.failureReason ??
            this.stateMachine.getFailureMessage(AITaskStatus.CANCELLED),
        }),
      },
    });

    // Log STATE_CHANGE activity
    const friendlyMessage = isTerminal
      ? this.stateMachine.getFailureMessage(toStatus)
      : `Tác vụ AI chuyển sang trạng thái: ${toStatus}.`;

    await this.activityService.log({
      organizationId,
      projectId: task.projectId,
      issueId: task.issueId,
      taskId,
      eventType: 'STATE_CHANGE',
      friendlyMessage,
      oldStatus: task.status,
      newStatus: toStatus,
      actorId: 'system',
    });

    return updated;
  }

  /**
   * Resume a task from WAITING_APPROVAL back to QUEUED.
   * Marks preflightApproved=true so the worker skips the major-error gate.
   * Re-enqueues the AI_CODING job.
   * Requirements: pre-flight approval flow
   */
  async resume(taskId: string, organizationId: string): Promise<AITask> {
    const task = await this.findById(taskId, organizationId);

    // WAITING_APPROVAL → QUEUED
    this.stateMachine.assertValidTransition(task.status, AITaskStatus.QUEUED);

    const updated = await this.prisma.aITask.update({
      where: { id: taskId },
      data: {
        status: AITaskStatus.QUEUED,
        failureReason: null,
        preflightApproved: true,
        currentStep: 'Chờ xử lý lại (người dùng đã xác nhận)',
      },
    });

    await this.activityService.log({
      organizationId,
      projectId: task.projectId,
      issueId: task.issueId,
      taskId,
      eventType: 'STATE_CHANGE',
      friendlyMessage: 'Người dùng đã xác nhận tiếp tục. Task được đưa lại vào hàng đợi.',
      oldStatus: task.status,
      newStatus: AITaskStatus.QUEUED,
      actorId: 'user',
    });

    // Re-enqueue the AI_CODING job
    await this.queueService.enqueueAICoding({
      taskId,
      issueId: task.issueId,
      projectId: task.projectId,
      organizationId,
    });

    return updated;
  }
}
