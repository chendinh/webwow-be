import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Project, ProjectAnalysis, ProjectStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { GithubService } from '../github/github.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

// ─── Constants ────────────────────────────────────────────────────────────────

// Vietnamese customer-friendly messages
const MSG = {
  PROJECT_NOT_FOUND: 'Dự án không tồn tại hoặc bạn không có quyền truy cập.',
  ANALYSIS_RUNNING:
    'Không thể phân tích lại khi đang có tác vụ AI đang chạy cho dự án này. Vui lòng chờ tác vụ hiện tại hoàn thành.',
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly githubService: GithubService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────────────

  /**
   * Creates a new Project linked to a GitHub repo.
   * Sets status = PENDING_ANALYSIS.
   * Enqueues a PROJECT_ANALYSIS job to QueueService.
   * Requirements: R3.5, R3.7
   */
  async create(organizationId: string, dto: CreateProjectDto): Promise<Project> {
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description ?? null,
        githubRepoFullName: dto.githubRepoFullName,
        githubInstallationId: dto.githubInstallationId,
        defaultBranch: dto.defaultBranch ?? 'main',
        status: ProjectStatus.PENDING_ANALYSIS,
      },
    });

    // Requirements: R15.3 — enqueue project analysis job after creation
    this.queueService
      .enqueueProjectAnalysis({
        projectId: project.id,
        organizationId,
        githubInstallationId: project.githubInstallationId,
        repoFullName: project.githubRepoFullName,
        branch: project.defaultBranch,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to enqueue project-analysis job for project ${project.id}: ${String(err)}`,
        );
      });

    return project;
  }

  // ── Find All ──────────────────────────────────────────────────────────────────

  /**
   * Returns all non-deleted projects for the organization.
   * MUST include organizationId filter (multi-tenant isolation).
   * Requirements: R22.3
   */
  async findAll(organizationId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Find By ID ────────────────────────────────────────────────────────────────

  /**
   * Returns a single project by ID.
   * Verifies organizationId matches — returns 404 for both "not found" and "wrong org".
   * Requirements: R22.3
   */
  async findById(projectId: string, organizationId: string): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId, // enforces multi-tenant isolation
        deletedAt: null,
      },
    });

    if (!project) {
      throw new NotFoundException(MSG.PROJECT_NOT_FOUND);
    }

    return project;
  }

  // ── Get Analysis ──────────────────────────────────────────────────────────────

  /**
   * Returns the ProjectAnalysis for a project.
   * Requirements: R4.1-R4.7
   */
  async getAnalysis(
    projectId: string,
    organizationId: string,
  ): Promise<ProjectAnalysis | null> {
    // First verify the project exists and belongs to the org
    await this.findById(projectId, organizationId);

    return this.prisma.projectAnalysis.findUnique({
      where: { projectId },
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────────

  /**
   * Updates project name/description/defaultBranch.
   */
  async update(
    projectId: string,
    organizationId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    // Verify ownership and existence
    await this.findById(projectId, organizationId);

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.defaultBranch !== undefined && { defaultBranch: dto.defaultBranch }),
      },
    });
  }

  // ── Soft Delete ───────────────────────────────────────────────────────────────

  /**
   * Soft deletes a project (sets deletedAt).
   */
  async softDelete(projectId: string, organizationId: string): Promise<void> {
    // Verify ownership and existence
    await this.findById(projectId, organizationId);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  // ── `ai/main` branch + Deploy ────────────────────────────────────────────────

  /**
   * Ensures ai/main staging branch exists, creating it from defaultBranch if needed.
   */
  async ensureAiMainBranch(projectId: string, organizationId: string): Promise<string> {
    const project = await this.findById(projectId, organizationId);
    const [owner, repo] = project.githubRepoFullName.split('/');
    const aiMainBranch = 'ai/main';

    // Try to create — if it already exists, the error is silently swallowed
    try {
      await this.githubService.createBranch(organizationId, owner, repo, aiMainBranch, project.defaultBranch);
    } catch {
      // Branch likely already exists — that's fine
    }

    return aiMainBranch;
  }

  /**
   * Merges a completed AI PR branch into the ai/main staging branch via GitHub API.
   */
  async mergeIntoAiMain(projectId: string, organizationId: string, prBranchName: string, prTitle: string): Promise<void> {
    const project = await this.findById(projectId, organizationId);
    const [owner, repo] = project.githubRepoFullName.split('/');
    const aiMainBranch = 'ai/main';

    // Ensure ai/main exists
    try {
      await this.githubService.createBranch(organizationId, owner, repo, aiMainBranch, project.defaultBranch);
    } catch { /* already exists */ }

    // Create a merge PR from the AI task branch into ai/main
    await this.githubService.createPullRequest(organizationId, owner, repo, {
      title: `[staging] ${prTitle}`,
      body: `Auto-merge from ${prBranchName} into staging branch ai/main`,
      head: prBranchName,
      base: aiMainBranch,
    });
  }

  /**
   * Deploys ai/main → defaultBranch (main) by creating a merge PR.
   */
  async deployToMain(projectId: string, organizationId: string): Promise<{ prUrl: string; prNumber: number }> {
    const project = await this.findById(projectId, organizationId);
    const [owner, repo] = project.githubRepoFullName.split('/');

    const { number, htmlUrl } = await this.githubService.createPullRequest(
      organizationId, owner, repo,
      {
        title: `🚀 Deploy AI changes to ${project.defaultBranch}`,
        body: `This PR merges all completed AI tasks from the \`ai/main\` staging branch into \`${project.defaultBranch}\`.\n\nReview the changes and merge when ready to deploy.`,
        head: 'ai/main',
        base: project.defaultBranch,
      },
    );

    return { prUrl: htmlUrl, prNumber: number };
  }

  // ── Health Check ──────────────────────────────────────────────────────────────

  /**
   * Triggers a health check scan for the project.
   * Returns immediately — result is stored async via the worker.
   */
  async triggerHealthCheck(projectId: string, organizationId: string): Promise<void> {
    const project = await this.findById(projectId, organizationId);

    // Prevent concurrent runs
    if (project.healthCheckStatus === 'RUNNING') {
      throw new Error('Health check đang chạy. Vui lòng đợi hoàn thành.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { healthCheckStatus: 'RUNNING' },
    });

    this.queueService
      .enqueueHealthCheck({
        projectId,
        organizationId,
        repoFullName: project.githubRepoFullName,
        branch: project.defaultBranch,
        githubInstallationId: project.githubInstallationId,
      })
      .catch((err: unknown) => {
        this.logger.warn(`Failed to enqueue health check for project ${projectId}: ${String(err)}`);
      });
  }

  /**
   * Returns the latest health check result for a project.
   */
  async getHealthCheck(projectId: string, organizationId: string): Promise<{
    status: string | null;
    result: unknown;
    checkedAt: Date | null;
  }> {
    const project = await this.findById(projectId, organizationId);
    return {
      status: project.healthCheckStatus ?? null,
      result: project.healthCheckResult ?? null,
      checkedAt: project.healthCheckedAt ?? null,
    };
  }

  /**
   * Re-triggers PROJECT_ANALYSIS for the project.
   * Requirements: R15.4 — only if no AITask is currently running for this project.
   */
  async reanalyze(projectId: string, organizationId: string): Promise<void> {
    // Verify ownership and existence
    const project = await this.findById(projectId, organizationId);

    // R15.4: block if any AITask is currently running for this project
    const runningTask = await this.prisma.aITask.findFirst({
      where: {
        projectId,
        organizationId,
        status: {
          in: [
            'QUEUED',
            'ANALYZING',
            'PLANNING',
            'WAITING_APPROVAL',
            'APPROVED',
            'PREPARING',
            'CODING',
            'TESTING',
            'FIXING',
            'REVIEWING',
            'CREATING_PR',
          ],
        },
      },
      select: { id: true },
    });

    if (runningTask) {
      throw new Error(MSG.ANALYSIS_RUNNING);
    }

    // Update project status back to PENDING_ANALYSIS
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.PENDING_ANALYSIS },
    });

    // Requirements: R15.3, R23.1 — enqueue re-analysis job
    this.queueService
      .enqueueProjectAnalysis({
        projectId,
        organizationId,
        githubInstallationId: project.githubInstallationId,
        repoFullName: project.githubRepoFullName,
        branch: project.defaultBranch,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to enqueue re-analysis job for project ${projectId}: ${String(err)}`,
        );
      });
  }
}
