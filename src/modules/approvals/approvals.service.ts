import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IssueStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const MSG = {
  ISSUE_NOT_FOUND:
    'Vấn đề không tồn tại hoặc bạn không có quyền truy cập.',
  NOT_PLAN_READY:
    'Issue không ở trạng thái chờ phê duyệt.',
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Customer approves the implementation plan.
   * AI MUST NOT have modified code before this point.
   * Requirements: R9.1, R9.3
   *
   * Steps:
   * 1. Verify issue exists, belongs to org, is in PLAN_READY status
   * 2. Update issue status → APPROVED
   * 3. Log APPROVAL_DECISION with userId + timestamp + ipAddress (R9.3)
   * 4. Create AITask record with status QUEUED
   * 5. Enqueue AI_CODING job
   */
  async approve(
    issueId: string,
    organizationId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    // 1. Verify issue exists, belongs to org, not soft-deleted
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null },
    });

    if (!issue) {
      throw new NotFoundException(MSG.ISSUE_NOT_FOUND);
    }

    // Issue must be in PLAN_READY state before approval is allowed (R9.1)
    if (issue.status !== IssueStatus.PLAN_READY) {
      throw new BadRequestException(MSG.NOT_PLAN_READY);
    }

    // 2. Update issue status → APPROVED
    await this.prisma.issue.update({
      where: { id: issueId },
      data: { status: IssueStatus.APPROVED },
    });

    // 3. Log approval decision with userId + timestamp + ipAddress (R9.3)
    await this.prisma.activityLog.create({
      data: {
        organizationId,
        issueId,
        eventType: 'APPROVAL_DECISION',
        friendlyMessage: 'Khách hàng đã phê duyệt kế hoạch thực hiện.',
        actorId: userId,
        ipAddress: ipAddress ?? null,
        oldStatus: IssueStatus.PLAN_READY,
        newStatus: IssueStatus.APPROVED,
      },
    });

    // 4. Create AITask record with status QUEUED
    const task = await this.prisma.aITask.create({
      data: {
        organizationId,
        projectId: issue.projectId,
        issueId: issue.id,
        status: 'QUEUED',
      },
    });

    // 5. Enqueue AI_CODING job (fire-and-forget — task is already created)
    await this.queueService.enqueueAICoding({
      taskId: task.id,
      issueId: issue.id,
      projectId: issue.projectId,
      organizationId,
    });
  }

  /**
   * Customer rejects the implementation plan.
   * Requirements: R9.4
   *
   * Steps:
   * 1. Verify issue exists, belongs to org, is in PLAN_READY status
   * 2. Update issue status → REJECTED, persist rejectionReason
   * 3. Log APPROVAL_DECISION with userId + timestamp + reason
   */
  async reject(
    issueId: string,
    organizationId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    // 1. Verify issue exists, belongs to org, not soft-deleted
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null },
    });

    if (!issue) {
      throw new NotFoundException(MSG.ISSUE_NOT_FOUND);
    }

    // Issue must be in PLAN_READY state before rejection is allowed (R9.4)
    if (issue.status !== IssueStatus.PLAN_READY) {
      throw new BadRequestException(MSG.NOT_PLAN_READY);
    }

    // 2. Update issue status → REJECTED, persist rejectionReason
    await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        status: IssueStatus.REJECTED,
        rejectionReason: reason ?? null,
      },
    });

    // 3. Log rejection decision (R9.4)
    const friendlyMessage = reason
      ? `Khách hàng đã từ chối kế hoạch thực hiện. Lý do: ${reason}`
      : 'Khách hàng đã từ chối kế hoạch thực hiện.';

    await this.prisma.activityLog.create({
      data: {
        organizationId,
        issueId,
        eventType: 'APPROVAL_DECISION',
        friendlyMessage,
        actorId: userId,
        oldStatus: IssueStatus.PLAN_READY,
        newStatus: IssueStatus.REJECTED,
        technicalDetail: reason ? { reason } : undefined,
      },
    });
  }
}
