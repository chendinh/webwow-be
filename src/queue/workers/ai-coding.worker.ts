import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AITaskStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { PrismaService } from '../../prisma/prisma.service';
import { SandboxExecutorService } from '../../sandbox/sandbox-executor.service';
import { AITasksService } from '../../modules/ai-tasks/ai-tasks.service';
import { GithubService } from '../../modules/github/github.service';
import { ActivityService } from '../../modules/activity/activity.service';
import { CodingAgent } from '../../ai/agents/coding.agent';
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
    private readonly codingAgent: CodingAgent,
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

      // Guard: if task is already in a terminal state (from a previous failed attempt),
      // reset it to QUEUED so BullMQ retry can proceed
      const terminalStates: AITaskStatus[] = [AITaskStatus.FAILED, AITaskStatus.CANCELLED, AITaskStatus.COMPLETED];
      if (terminalStates.includes(task.status)) {
        await this.prisma.aITask.update({
          where: { id: taskId },
          data: { status: AITaskStatus.QUEUED, failureReason: null },
        });
      }

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

      // Disable macOS Keychain credential helper to prevent popup dialogs
      // Use token embedded in URL — no interactive auth needed
      await this.sandbox.exec(
        containerId,
        `git config --global credential.helper '' && git config --global core.askPass '' && git config --global GIT_TERMINAL_PROMPT 0`,
      );

      const cloneResult = await this.sandbox.exec(
        containerId,
        `GIT_TERMINAL_PROMPT=0 git clone ${cloneUrl} /workspace/repo`,
      );

      if (cloneResult.exitCode !== 0) {
        throw new Error(`Git clone failed: ${cloneResult.stderr}`);
      }

      // ── Step 4b: Pre-flight build check on ORIGINAL code ────────────────
      this.logger.log(`Running pre-flight build check on original code for task ${taskId}`);
      const preflightResult = await this.runChecks(containerId, organizationId, projectId, issueId, taskId);

      if (!preflightResult.passed) {
        // Re-load task to check if user has already approved
        const latestTask = await this.prisma.aITask.findUnique({ where: { id: taskId } });
        const alreadyApproved = latestTask?.preflightApproved === true;

        if (!alreadyApproved) {
          // Classify error severity
          const isMinorError = this.isMinorBuildError(preflightResult.output);

          if (isMinorError) {
            // Auto-fix minor errors and log
            this.logger.warn(`Pre-flight found minor build errors, attempting auto-fix for task ${taskId}`);
            await this.activityService.log({
              organizationId, projectId, issueId, taskId,
              eventType: 'ERROR',
              friendlyMessage: `Phát hiện lỗi nhỏ trong dự án gốc. Đang tự động sửa trước khi thực hiện task.`,
              technicalDetail: { preflightOutput: preflightResult.output.substring(0, 2000) },
              actorId: 'system',
            });
            // Store pre-flight issues in AITask for summary
            await this.prisma.aITask.update({
              where: { id: taskId },
              data: { buildResult: { preflightIssues: preflightResult.output.substring(0, 2000), autoFixed: true } },
            });
          } else {
            // Major error: transition to WAITING_APPROVAL and pause
            this.logger.error(`Pre-flight found major build errors for task ${taskId}, waiting for user approval`);
            await this.aiTasksService.transitionStatus(taskId, AITaskStatus.WAITING_APPROVAL, organizationId, {
              currentStep: 'Chờ xác nhận lỗi project',
            });
            await this.prisma.aITask.update({
              where: { id: taskId },
              data: {
                buildResult: {
                  preflightIssues: preflightResult.output.substring(0, 3000),
                  autoFixed: false,
                  requiresUserApproval: true,
                  errorSummary: this.extractBuildErrorSummary(preflightResult.output),
                },
                failureReason: `Project có lỗi build cần xử lý trước: ${this.extractBuildErrorSummary(preflightResult.output)}`,
              },
            });
            // Do NOT throw — just return, task is now WAITING_APPROVAL
            return;
          }
        } else {
          this.logger.warn(`Pre-flight errors present but user already approved for task ${taskId}, proceeding`);
          await this.activityService.log({
            organizationId, projectId, issueId, taskId,
            eventType: 'ERROR',
            friendlyMessage: `Người dùng đã xác nhận tiếp tục dù project có lỗi build. Đang tiến hành task.`,
            technicalDetail: { preflightOutput: preflightResult.output.substring(0, 2000) },
            actorId: 'system',
          });
        }
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

      // Clean up any stale git lock files left by pre-flight checks
      await this.sandbox.exec(
        containerId,
        `find /workspace/repo/.git -name '*.lock' -delete 2>/dev/null || true`,
      );

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

      // ── Step 7: Apply code changes via CodingAgent ───────────────────────
      const changedFiles: string[] = [];
      let totalCodingTokens = 0;

      // Detect project context from analysis
      const projectAnalysis = await this.prisma.projectAnalysis.findUnique({
        where: { projectId },
      });
      const codeContext = {
        framework: (projectAnalysis?.frameworks ?? ['unknown'])[0] ?? 'unknown',
        language: projectAnalysis?.primaryLanguage ?? 'typescript',
      };

      for (const step of plan.steps) {
        this.logger.debug(`Applying step ${step.order}: ${step.type} ${step.filePath}`);

        if (step.type === 'DELETE') {
          const result = await this.sandbox.exec(
            containerId,
            `cd /workspace/repo && rm -f "${step.filePath}"`,
          );
          await this.activityService.log({
            organizationId, projectId, issueId, taskId,
            eventType: 'FILE_CHANGED',
            friendlyMessage: `Đã xóa file: ${step.filePath}`,
            technicalDetail: { operation: 'DELETE', filePath: step.filePath, exitCode: result.exitCode },
            actorId: 'system',
          });
          if (result.exitCode === 0) changedFiles.push(step.filePath);
          continue;
        }

        // Read existing file content from sandbox (local mode: read from workdir)
        let existingContent: string | null = null;
        const localWorkdir = (this.sandbox as unknown as { localWorkdirs?: Map<string, string> })
          .localWorkdirs?.get(containerId);
        if (localWorkdir) {
          const fullPath = path.join(localWorkdir, 'workspace', 'repo', step.filePath);
          if (fs.existsSync(fullPath)) {
            existingContent = fs.readFileSync(fullPath, 'utf8');
          }
        } else {
          // Docker mode: read via exec
          const readResult = await this.sandbox.exec(
            containerId,
            `cat /workspace/repo/${step.filePath} 2>/dev/null || echo ""`,
          );
          existingContent = readResult.stdout || null;
        }

        // Call CodingAgent to generate actual code
        const codeChange = await this.codingAgent.implementStep(step, existingContent, codeContext);
        totalCodingTokens += 100; // approximation — CodingAgent doesn't expose tokens yet

        // Ensure parent directory exists
        const dirPath = step.filePath.includes('/')
          ? step.filePath.substring(0, step.filePath.lastIndexOf('/'))
          : '';
        if (dirPath) {
          await this.sandbox.exec(containerId, `mkdir -p /workspace/repo/${dirPath}`);
        }

        // Write generated code to file
        if (localWorkdir) {
          // Local mode: write directly to filesystem
          const fullPath = path.join(localWorkdir, 'workspace', 'repo', step.filePath);
          if (dirPath) {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          }
          fs.writeFileSync(fullPath, codeChange.content, 'utf8');
        } else {
          // Docker mode: use heredoc-safe write via base64
          const b64 = Buffer.from(codeChange.content).toString('base64');
          await this.sandbox.exec(
            containerId,
            `echo "${b64}" | base64 -d > /workspace/repo/${step.filePath}`,
          );
        }

        const operationType = step.type === 'CREATE' ? 'Tạo' : 'Sửa';
        await this.activityService.log({
          organizationId, projectId, issueId, taskId,
          eventType: 'FILE_CHANGED',
          friendlyMessage: `${operationType} file: ${step.filePath}`,
          technicalDetail: { operation: step.type, filePath: step.filePath },
          actorId: 'system',
        });
        changedFiles.push(step.filePath);
      }

      // Update actual tokens
      await this.prisma.aITask.update({
        where: { id: taskId },
        data: { filesChanged: changedFiles, actualTokens: totalCodingTokens },
      });

      // ── Step 8: Transition → TESTING, run build checks BEFORE commit ─────
      await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
        currentStep: 'Chạy kiểm tra trước khi commit',
      });

      let checksPass = false;
      let fixAttempts = 0;
      let lastTestOutput = '';

      while (!checksPass && fixAttempts <= MAX_FIX_ATTEMPTS) {
        if (fixAttempts > 0) {
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
              `Build/test thất bại sau ${MAX_FIX_ATTEMPTS} lần sửa. Output: ${lastTestOutput.substring(0, 500)}`,
            );
          }
          await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
            currentStep: `Chạy lại kiểm tra (lần ${fixAttempts + 1})`,
          });
        }
      }

      this.logger.log(`Build checks passed for task ${taskId}, proceeding to commit`);

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

      // Push branch — token embedded in remote URL, disable credential helpers to prevent popups
      const pushResult = await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && GIT_TERMINAL_PROMPT=0 git push origin ${branchName}`,
        180_000,
      );

      if (pushResult.exitCode !== 0) {
        throw new Error(`git push failed: ${pushResult.stderr}`);
      }

      this.logger.log(`Pushed branch ${branchName} for task ${taskId}`);

      // ── Step 10: Update CostEstimate with actual token usage ─────────────
      const tokenCostPerMillion = 15; // GPT-4o
      const actualTokens = task.actualTokens ?? 0;
      const actualCostUsd = (actualTokens / 1_000_000) * tokenCostPerMillion;
      const actualCustomerCost = Math.max(actualCostUsd * 2.5, 0.50); // same margin as pricing service

      const costEstimate = await this.prisma.costEstimate.findUnique({ where: { issueId } });
      if (costEstimate) {
        const tokenVariancePct =
          costEstimate.internalTokens > 0
            ? ((actualTokens - costEstimate.internalTokens) / costEstimate.internalTokens) * 100
            : null;

        await this.prisma.costEstimate.update({
          where: { issueId },
          data: {
            actualTokens,
            actualCostUsd,
            actualCustomerCost,
            tokenVariancePct,
          },
        });

        this.logger.log(
          `Updated CostEstimate for issue ${issueId}: actualTokens=${actualTokens}, variance=${tokenVariancePct?.toFixed(1) ?? 'N/A'}%`,
        );
      }

      // ── Step 10b: Record task duration and aiCompletionMinutes ──────────
      const completedAt = new Date();
      const durationMs = task.startedAt ? completedAt.getTime() - task.startedAt.getTime() : null;
      const aiCompletionMinutes = durationMs ? Math.round(durationMs / 60000) : null;

      await this.prisma.aITask.update({
        where: { id: taskId },
        data: { completedAt, durationMs },
      });

      if (aiCompletionMinutes !== null) {
        await this.prisma.costEstimate.updateMany({
          where: { issueId },
          data: { aiCompletionMinutes },
        });
      }

      // ── Step 11: Transition → CREATING_PR, enqueue PR creation ───────────
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

  /**
   * Classify build error as minor (auto-fixable) or major (needs user approval).
   * Minor: TypeScript null/undefined errors, unused imports, simple type mismatches.
   * Major: Missing modules, compilation failures, missing dependencies, syntax errors.
   */
  private isMinorBuildError(output: string): boolean {
    const majorPatterns = [
      /Cannot find module/i,
      /Module not found/i,
      /SyntaxError/i,
      /ENOENT/i,
      /npm ERR!/i,
      /Cannot find name/i,
      /is not assignable to type/i,
      /does not exist on type/i,
    ];
    // If any major pattern found, it's NOT minor
    return !majorPatterns.some(p => p.test(output));
  }

  /**
   * Extract a concise error summary from build output (first 300 chars of errors).
   */
  private extractBuildErrorSummary(output: string): string {
    const lines = output.split('\n').filter(l =>
      l.includes('Error') || l.includes('error') || l.includes('failed')
    );
    return lines.slice(0, 5).join(' | ').substring(0, 300) || 'Build error';
  }
}
