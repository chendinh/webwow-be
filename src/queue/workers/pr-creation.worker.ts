import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { GithubService } from '../../modules/github/github.service';
import { AITasksService } from '../../modules/ai-tasks/ai-tasks.service';
import { ProjectsService } from '../../modules/projects/projects.service';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { PRCreationJobData } from '../queue.types';

@Processor(QUEUES.PR_CREATION, { concurrency: CONCURRENCY.PR_CREATION })
export class PRCreationWorker extends WorkerHost {
  private readonly logger = new Logger(PRCreationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    private readonly aiTasksService: AITasksService,
    private readonly projectsService: ProjectsService,
  ) {
    super();
  }

  async process(job: Job<PRCreationJobData>): Promise<void> {
    const { taskId, issueId, projectId, organizationId, branchName } = job.data;

    this.logger.log(`Starting PR creation for task ${taskId}`);

    try {
      // ── Step 1: Load task + issue + project ──────────────────────────────
      const task = await this.prisma.aITask.findUnique({
        where: { id: taskId },
        include: { issue: true, project: true },
      });

      if (!task) {
        throw new Error(`AITask ${taskId} not found`);
      }

      const { issue, project } = task;

      // ── Step 2: Parse owner/repo from githubRepoFullName ─────────────────
      const [owner, repo] = project.githubRepoFullName.split('/');

      if (!owner || !repo) {
        throw new Error(
          `Invalid githubRepoFullName "${project.githubRepoFullName}" — expected "owner/repo"`,
        );
      }

      // ── Step 3: Create PR via GitHub API ──────────────────────────────────
      this.logger.log(`Creating PR on ${owner}/${repo} from branch ${branchName}`);

      const { number, htmlUrl } = await this.githubService.createPullRequest(
        organizationId,
        owner,
        repo,
        {
          title: `feat: ${issue.title}`,
          body: `## Thay đổi do AI thực hiện\n\n${issue.aiDiagnosis ?? ''}\n\n**Các file thay đổi:** ${task.filesChanged.join(', ')}\n\n> Vui lòng review và merge khi sẵn sàng.`,
          head: branchName,
          base: project.defaultBranch,
        },
      );

      this.logger.log(`PR #${number} created: ${htmlUrl}`);

      // ── Step 4: Persist PullRequest record ────────────────────────────────
      await this.prisma.pullRequest.create({
        data: {
          organizationId,
          projectId,
          issueId,
          taskId,
          githubPrNumber: number,
          githubPrUrl: htmlUrl,
          title: `feat: ${issue.title}`,
          branchName,
          status: 'OPEN',
        },
      });

      // ── Step 5: Transition AITask → COMPLETED ─────────────────────────────
      await this.aiTasksService.transitionStatus(taskId, 'COMPLETED', organizationId);
      await this.prisma.aITask.update({
        where: { id: taskId },
        data: { completedAt: new Date() },
      });

      // ── Step 5b: Update Issue status → COMPLETED ──────────────────────────
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { status: 'COMPLETED' },
      });

      // ── Step 6: Log ActivityLog PR_CREATED ────────────────────────────────
      await this.prisma.activityLog.create({
        data: {
          organizationId,
          projectId,
          issueId,
          taskId,
          eventType: 'PR_CREATED',
          friendlyMessage: `Pull Request đã được tạo thành công: ${htmlUrl}`,
          actorId: 'system',
        },
      });

      // ── Step 7: Auto-merge into ai/main staging branch ────────────────────
      try {
        await this.projectsService.mergeIntoAiMain(projectId, organizationId, branchName, `feat: ${issue.title}`);
        this.logger.log(`Merged ${branchName} into ai/main for project ${projectId}`);
      } catch (mergeErr) {
        // Non-fatal — the PR to main was already created; ai/main merge is best-effort
        this.logger.warn(`Could not merge ${branchName} into ai/main: ${String(mergeErr)}`);
      }

      this.logger.log(`PR creation completed for task ${taskId}`);
    } catch (err: unknown) {
      this.logger.error(
        `PR creation failed for task ${taskId}`,
        err instanceof Error ? err.stack : String(err),
      );

      // Transition task → FAILED
      try {
        await this.aiTasksService.transitionStatus(taskId, 'FAILED', organizationId, {
          failureReason: 'Không thể tạo Pull Request. Vui lòng kiểm tra kết nối GitHub và thử lại.',
        });
      } catch (transitionErr: unknown) {
        this.logger.error(
          `Failed to transition task ${taskId} to FAILED`,
          transitionErr instanceof Error ? transitionErr.stack : String(transitionErr),
        );
      }

      // Log error to ActivityLog
      await this.prisma.activityLog.create({
        data: {
          organizationId,
          projectId,
          issueId,
          taskId,
          eventType: 'ERROR',
          friendlyMessage: 'Không thể tạo Pull Request. Vui lòng kiểm tra kết nối GitHub và thử lại.',
          technicalDetail: { error: String(err) },
          actorId: 'system',
        },
      });

      // Re-throw so BullMQ handles retry
      throw err;
    }
  }
}
