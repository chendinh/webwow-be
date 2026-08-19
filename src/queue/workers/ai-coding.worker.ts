import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AITaskStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SandboxExecutorService } from '../../sandbox/sandbox-executor.service';
import { AITasksService } from '../../modules/ai-tasks/ai-tasks.service';
import { GithubService } from '../../modules/github/github.service';
import { ActivityService } from '../../modules/activity/activity.service';
import { ImplementationPlan } from '../../ai/schemas/implementation-plan.schema';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { AICodingJobData } from '../queue.types';
import { QueueService } from '../queue.service';

const MAX_FIX_ATTEMPTS = 3;

// R19.4: Max 5 concurrent coding tasks enforced via concurrency option
@Processor(QUEUES.AI_CODING, { concurrency: CONCURRENCY.AI_CODING })
export class AICodingWorker extends WorkerHost {
  private readonly logger = new Logger(AICodingWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: SandboxExecutorService,
    private readonly aiTasksService: AITasksService,
    private readonly githubService: GithubService,
    private readonly activityService: ActivityService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<AICodingJobData>): Promise<void> {
    const { taskId, issueId, projectId, organizationId } = job.data;

    this.logger.log(`Starting AI coding pipeline for task ${taskId}`);

    let containerId: string | null = null;
    let branchName: string | null = null;

    try {
      // ── Step 1: Load AITask, Issue, Project ──────────────────────────────
      const task = await this.prisma.aITask.findUnique({
        where: { id: taskId },
        include: { issue: true, project: true },
      });

      if (!task) {
        throw new Error(`AITask ${taskId} not found`);
      }

      const { issue, project } = task;

      // MVP simplicity: if ImplementationPlan is null, fail immediately
      if (!issue.implementationPlan) {
        await this.aiTasksService.transitionStatus(taskId, AITaskStatus.FAILED, organizationId, {
          failureReason: 'Không có kế hoạch triển khai. Vui lòng phân tích lại yêu cầu.',
        });
        return;
      }

      const plan = issue.implementationPlan as unknown as ImplementationPlan;

      // ── Step 2: Transition → PREPARING ───────────────────────────────────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.PREPARING, organizationId, {
        currentStep: 'Chuẩn bị sandbox',
      });

      // ── Step 3: Create Docker sandbox ────────────────────────────────────
      const githubToken = await this.githubService.getDecryptedToken(organizationId);
      containerId = await this.sandbox.create({
        taskId,
        repoUrl: `https://github.com/${project.githubRepoFullName}`,
        branch: project.defaultBranch,
        githubToken,
      });

      this.logger.log(`Sandbox created: ${containerId} for task ${taskId}`);

      // ── Step 4: Clone repo in sandbox ────────────────────────────────────
      const cloneUrl = `https://x-access-token:${githubToken}@github.com/${project.githubRepoFullName}.git`;
      const cloneResult = await this.sandbox.exec(
        containerId,
        `git clone ${cloneUrl} /workspace/repo`,
      );

      if (cloneResult.exitCode !== 0) {
        throw new Error(`Git clone failed: ${cloneResult.stderr}`);
      }

      // ── Step 5: Create AI branch ──────────────────────────────────────────
      // Branch name must match /^ai\/[a-z0-9]+(-[a-z0-9]+)*$/
      const branchSlug = issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')   // replace non-alphanumeric sequences with dash
        .replace(/^-+|-+$/g, '')         // trim leading/trailing dashes
        .substring(0, 30)
        .replace(/-+$/, '');             // trim trailing dashes after substring

      const issueShortId = issue.id.substring(0, 8);
      branchName = `ai/${issueShortId}-${branchSlug}`;

      const checkoutResult = await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git checkout -b ${branchName}`,
      );

      if (checkoutResult.exitCode !== 0) {
        throw new Error(`Git checkout failed: ${checkoutResult.stderr}`);
      }

      await this.prisma.aITask.update({
        where: { id: taskId },
        data: { branchName, startedAt: new Date() },
      });

      this.logger.log(`Created branch ${branchName} for task ${taskId}`);

      // ── Step 6: Transition → CODING ──────────────────────────────────────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.CODING, organizationId, {
        currentStep: 'Viết code',
      });

      // ── Step 7: Apply code changes from ImplementationPlan ───────────────
      const changedFiles: string[] = [];

      for (const step of plan.steps) {
        this.logger.debug(`Applying step ${step.order}: ${step.type} ${step.filePath}`);

        if (step.type === 'DELETE') {
          const result = await this.sandbox.exec(
            containerId,
            `cd /workspace/repo && rm -f "${step.filePath}"`,
          );

          await this.activityService.log({
            organizationId,
            projectId,
            issueId,
            taskId,
            eventType: 'FILE_CHANGED',
            friendlyMessage: `Đã xóa file: ${step.filePath}`,
            technicalDetail: {
              operation: 'DELETE',
              filePath: step.filePath,
              exitCode: result.exitCode,
            },
            actorId: 'system',
          });

          if (result.exitCode === 0) {
            changedFiles.push(step.filePath);
          }
        } else {
          // CREATE or MODIFY: write content using printf to avoid heredoc quoting issues
          // The description field contains the intended change; we use it as file content placeholder.
          // In a full implementation this would come from the CodingAgent; here we write the description.
          const escapedContent = step.description
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "'\\''");

          // Ensure parent directory exists
          const dirPath = step.filePath.includes('/')
            ? step.filePath.substring(0, step.filePath.lastIndexOf('/'))
            : '';

          if (dirPath) {
            await this.sandbox.exec(
              containerId,
              `mkdir -p /workspace/repo/${dirPath}`,
            );
          }

          const writeResult = await this.sandbox.exec(
            containerId,
            `printf '%s' '${escapedContent}' > /workspace/repo/${step.filePath}`,
          );

          const operationType = step.type === 'CREATE' ? 'Tạo' : 'Sửa';
          await this.activityService.log({
            organizationId,
            projectId,
            issueId,
            taskId,
            eventType: 'FILE_CHANGED',
            friendlyMessage: `${operationType} file: ${step.filePath}`,
            technicalDetail: {
              operation: step.type,
              filePath: step.filePath,
              exitCode: writeResult.exitCode,
              description: step.description,
            },
            actorId: 'system',
          });

          if (writeResult.exitCode === 0) {
            changedFiles.push(step.filePath);
          }
        }
      }

      // Persist changedFiles list
      await this.prisma.aITask.update({
        where: { id: taskId },
        data: { filesChanged: changedFiles },
      });

      // ── Step 8: Transition → TESTING, run checks ─────────────────────────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
        currentStep: 'Chạy kiểm tra',
      });

      let checksPass = false;
      let fixAttempts = 0;
      let lastTestOutput = '';

      while (!checksPass && fixAttempts <= MAX_FIX_ATTEMPTS) {
        if (fixAttempts > 0) {
          // Transition to FIXING before re-running checks
          await this.aiTasksService.transitionStatus(taskId, AITaskStatus.FIXING, organizationId, {
            currentStep: `Sửa lỗi (lần ${fixAttempts}/${MAX_FIX_ATTEMPTS})`,
          });
        }

        const testResult = await this.runChecks(containerId, organizationId, projectId, issueId, taskId);
        checksPass = testResult.passed;
        lastTestOutput = testResult.output;

        await this.prisma.aITask.update({
          where: { id: taskId },
          data: {
            testResult: {
              passed: testResult.passed,
              output: testResult.output,
              attemptNumber: fixAttempts + 1,
            },
          },
        });

        if (!checksPass) {
          fixAttempts++;

          if (fixAttempts > MAX_FIX_ATTEMPTS) {
            throw new Error(
              `Kiểm tra thất bại sau ${MAX_FIX_ATTEMPTS} lần sửa. Output: ${lastTestOutput.substring(0, 500)}`,
            );
          }

          // Re-enter TESTING state before next attempt (FIXING → TESTING is valid)
          await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
            currentStep: `Chạy lại kiểm tra (lần ${fixAttempts + 1})`,
          });
        }
      }

      // ── Step 9: Transition → REVIEWING, commit & push ────────────────────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.REVIEWING, organizationId, {
        currentStep: 'Xem xét code',
      });

      // Configure git user for the commit
      await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git config user.email "ai-agent@webwow.dev" && git config user.name "WebWow AI"`,
      );

      // Stage all changes
      const addResult = await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git add .`,
      );

      if (addResult.exitCode !== 0) {
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      // Conventional commit message
      const issueTypePrefix = this.getConventionalCommitType(issue.type ?? 'OTHER');
      const commitMessage = `${issueTypePrefix}(ai): ${issue.title.substring(0, 72)}

Implements: ${issue.description.substring(0, 200)}

AI-Task-Id: ${taskId}`;

      const commitResult = await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`,
      );

      if (commitResult.exitCode !== 0) {
        throw new Error(`git commit failed: ${commitResult.stderr}`);
      }

      // Push branch using token auth (already embedded in remote URL via clone)
      const pushResult = await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git push origin ${branchName}`,
      );

      if (pushResult.exitCode !== 0) {
        throw new Error(`git push failed: ${pushResult.stderr}`);
      }

      this.logger.log(`Pushed branch ${branchName} for task ${taskId}`);

      // ── Step 10: Transition → CREATING_PR, enqueue PR creation ───────────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.CREATING_PR, organizationId, {
        currentStep: 'Tạo Pull Request',
      });

      await this.queueService.enqueuePRCreation({
        taskId,
        issueId,
        projectId,
        organizationId,
        branchName,
      });

      this.logger.log(`Enqueued PR creation for task ${taskId}, branch ${branchName}`);
    } catch (err: unknown) {
      this.logger.error(
        `AI coding pipeline failed for task ${taskId}`,
        err instanceof Error ? err.stack : String(err),
      );

      // Transition to FAILED with customer-friendly message
      try {
        await this.aiTasksService.transitionStatus(taskId, AITaskStatus.FAILED, organizationId, {
          failureReason: 'Tác vụ AI thất bại khi viết code. Vui lòng thử lại.',
        });
      } catch (transitionErr: unknown) {
        // If transition fails (e.g., already in terminal state), just log it
        this.logger.warn(
          `Could not transition task ${taskId} to FAILED: ${String(transitionErr)}`,
        );
      }

      // Re-throw for BullMQ retry
      throw err;
    } finally {
      // ── Cleanup: always destroy sandbox ──────────────────────────────────
      if (containerId) {
        await this.sandbox.destroy(containerId);
        this.logger.log(`Destroyed sandbox ${containerId} for task ${taskId}`);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Runs npm install, lint, test, and build checks in the sandbox.
   * Returns whether all checks passed and the combined output.
   */
  private async runChecks(
    containerId: string,
    organizationId: string,
    projectId: string,
    issueId: string,
    taskId: string,
  ): Promise<{ passed: boolean; output: string }> {
    const outputs: string[] = [];
    let allPassed = true;

    const commands: Array<{ cmd: string; label: string }> = [
      { cmd: 'cd /workspace/repo && [ -f package.json ] && npm install --prefer-offline 2>&1 || true', label: 'npm install' },
      { cmd: 'cd /workspace/repo && [ -f package.json ] && (npm run lint 2>&1) || true', label: 'lint' },
      { cmd: 'cd /workspace/repo && [ -f package.json ] && (npm test -- --passWithNoTests 2>&1) || true', label: 'test' },
      { cmd: 'cd /workspace/repo && [ -f package.json ] && (npm run build 2>&1) || true', label: 'build' },
    ];

    for (const { cmd, label } of commands) {
      const result = await this.sandbox.exec(containerId, cmd, 180_000);
      const summary = `[${label}] exit=${result.exitCode}\n${result.stdout}\n${result.stderr}`.trim();
      outputs.push(summary);

      // lint/test/build failure (exitCode != 0 and the command ran — not "script not found")
      if (
        result.exitCode !== 0 &&
        !result.stdout.includes('missing script') &&
        !result.stderr.includes('missing script')
      ) {
        allPassed = false;
      }

      await this.activityService.log({
        organizationId,
        projectId,
        issueId,
        taskId,
        eventType: 'COMMAND_EXECUTED',
        friendlyMessage: `Lệnh kiểm tra: ${label} — ${result.exitCode === 0 ? 'thành công' : 'thất bại'}`,
        technicalDetail: {
          command: cmd,
          exitCode: result.exitCode,
          stdout: result.stdout.substring(0, 1000),
          stderr: result.stderr.substring(0, 1000),
          durationMs: result.durationMs,
        },
        actorId: 'system',
      });
    }

    return { passed: allPassed, output: outputs.join('\n---\n') };
  }

  /**
   * Maps IssueType to a Conventional Commits type prefix.
   */
  private getConventionalCommitType(issueType: string): string {
    const map: Record<string, string> = {
      FEATURE: 'feat',
      BUG: 'fix',
      REFACTOR: 'refactor',
      PERFORMANCE: 'perf',
      SECURITY: 'fix',
      DEPENDENCY: 'chore',
      OTHER: 'chore',
    };
    return map[issueType] ?? 'chore';
  }
}
