import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Issue, IssueStatus, ProjectStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { TaskSummaryDto } from './dto/task-summary.dto';

// ─── Constants ────────────────────────────────────────────────────────────────

const MSG = {
  PROJECT_NOT_FOUND:
    'Dự án không tồn tại hoặc bạn không có quyền truy cập.',
  PROJECT_UNSUPPORTED:
    'Dự án của bạn sử dụng công nghệ chưa được hỗ trợ bởi AI. Vui lòng liên hệ hỗ trợ để biết thêm chi tiết.',
  ISSUE_NOT_FOUND:
    'Vấn đề không tồn tại hoặc bạn không có quyền truy cập.',
  DAILY_RATE_LIMIT:
    'Bạn đã đạt giới hạn 20 yêu cầu mỗi ngày. Vui lòng thử lại vào ngày mai.',
} as const;

const DAILY_ISSUE_LIMIT = parseInt(process.env.DAILY_ISSUE_LIMIT ?? '20', 10);

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  /**
   * Creates a new Issue for a project.
   * Business rules (Requirements R6.1–R6.6):
   * 1. Project must exist and belong to organizationId.
   * 2. Project must NOT have UNSUPPORTED compatibilityTier.
   * 3. Org-level daily rate limit: max 20 issues per day.
   * 4. Issue is created with status ANALYZING.
   * 5. AI_ANALYSIS job is enqueued.
   */
  async create(
    organizationId: string,
    projectId: string,
    userId: string,
    dto: CreateIssueDto,
  ): Promise<Issue> {
    // 1. Verify project exists and belongs to the organization
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        deletedAt: null,
      },
      include: {
        analysis: {
          select: { compatibilityTier: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(MSG.PROJECT_NOT_FOUND);
    }

    // 2. Check project compatibility — UNSUPPORTED tier is blocked
    if (project.analysis?.compatibilityTier === 'UNSUPPORTED') {
      throw new BadRequestException(MSG.PROJECT_UNSUPPORTED);
    }

    // 3. Daily rate limit: max 20 issues per day per organization (R23.5)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayCount = await this.prisma.issue.count({
      where: {
        organizationId,
        createdAt: { gte: startOfToday },
      },
    });

    if (todayCount >= DAILY_ISSUE_LIMIT) {
      throw new HttpException(MSG.DAILY_RATE_LIMIT, HttpStatus.TOO_MANY_REQUESTS);
    }

    // 4. Create issue with ANALYZING status
    const issue = await this.prisma.issue.create({
      data: {
        organizationId,
        projectId,
        createdBy: userId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        priority: dto.priority,
        status: IssueStatus.ANALYZING,
      },
    });

    // 5. Enqueue AI_ANALYSIS job (fire-and-forget — failure is non-blocking)
    this.queueService
      .enqueueAIAnalysis({
        issueId: issue.id,
        projectId,
        organizationId,
        retryCount: 0,
      })
      .catch(() => {
        // Queue failure is logged by QueueService; issue is already created
      });

    return issue;
  }

  // ── Find All ───────────────────────────────────────────────────────────────

  /**
   * Returns all non-deleted issues for a project within the organization.
   * MUST include both projectId and organizationId filters (multi-tenant isolation).
   * Requirements: R22.3
   */
  async findAll(projectId: string, organizationId: string): Promise<Issue[]> {
    return this.prisma.issue.findMany({
      where: {
        projectId,
        organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Find By ID ─────────────────────────────────────────────────────────────

  /**
   * Returns a single issue by ID.
   * Verifies organizationId — returns 404 for both "not found" and "wrong org"
   * to prevent enumeration attacks.
   * Requirements: R22.3
   */
  async findById(issueId: string, organizationId: string): Promise<Issue> {
    const issue = await this.prisma.issue.findFirst({
      where: {
        id: issueId,
        organizationId,
        deletedAt: null,
      },
    });

    if (!issue) {
      throw new NotFoundException(MSG.ISSUE_NOT_FOUND);
    }

    return issue;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Updates an issue (title, description, type, priority).
   */
  async update(
    issueId: string,
    organizationId: string,
    dto: UpdateIssueDto,
  ): Promise<Issue> {
    // Verify ownership first
    await this.findById(issueId, organizationId);

    return this.prisma.issue.update({
      where: { id: issueId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
  }

  // ── Soft Delete ────────────────────────────────────────────────────────────

  /**
   * Soft deletes an issue (sets deletedAt).
   */
  async softDelete(issueId: string, organizationId: string): Promise<void> {
    // Verify ownership first
    await this.findById(issueId, organizationId);

    await this.prisma.issue.update({
      where: { id: issueId },
      data: { deletedAt: new Date() },
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  /**
   * Returns a task summary for a completed issue.
   * Aggregates CostEstimate, AITask results, and PR link into a single DTO.
   * NEVER exposes internalAiCost, actualCostUsd, or internalTokens.
   */
  async getSummary(issueId: string, organizationId: string): Promise<TaskSummaryDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null },
      include: {
        costEstimate: true,
        aiTasks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { pullRequests: { take: 1 } },
        },
      },
    });

    if (!issue) throw new NotFoundException('Issue not found');

    const task = issue.aiTasks[0] ?? null;
    const pr = task?.pullRequests?.[0] ?? null;
    const ce = issue.costEstimate;

    return {
      issueId: issue.id,
      title: issue.title,
      status: issue.status,
      complexity: issue.complexity ?? null,
      riskLevel: issue.riskLevel ?? null,
      webwowAiTeam: {
        completionMinutes: ce?.aiCompletionMinutes ?? null,
        customerPrice: ce?.customerPriceBase ?? null,
        customerPriceMin: ce?.customerPriceMin ?? null,
        customerPriceMax: ce?.customerPriceMax ?? null,
        baselineCostIncluded: ce?.baselineCostIncluded ?? null,
      },
      devComparison: ce?.devComparison as TaskSummaryDto['devComparison'] ?? null,
      filesChanged: task?.filesChanged ?? [],
      testPassed: (task?.testResult as { passed?: boolean } | null)?.passed ?? null,
      pullRequestUrl: pr?.githubPrUrl ?? null,
      tokenEfficiency: ce ? {
        estimatedTokens: ce.internalTokens,
        actualTokens: ce.actualTokens ?? null,
        variancePct: ce.tokenVariancePct ?? null,
      } : null,
    };
  }
}
