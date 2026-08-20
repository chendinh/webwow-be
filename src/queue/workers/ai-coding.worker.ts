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
import { KnowledgeReaderAgent } from '../../ai/agents/knowledge-reader.agent';
import { RulebookService } from '../../ai/knowledge/rulebook.service';
import { FailureLearnerService } from '../../ai/knowledge/failure-learner.service';
import { ImplementationPlan } from '../../ai/schemas/implementation-plan.schema';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { AICodingJobData } from '../queue.types';
import { QueueService } from '../queue.service';

const MAX_FIX_ATTEMPTS = 100;

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
    private readonly rulebookService: RulebookService,
    private readonly failureLearner: FailureLearnerService,
    private readonly knowledgeReaderAgent: KnowledgeReaderAgent,
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

      // Guard: reset task to QUEUED whenever BullMQ retries the job.
      // This handles both terminal states (FAILED/CANCELLED) AND mid-flight states
      // (TESTING, FIXING, CODING, etc.) that were left dirty by a previous crashed attempt.
      const resetableStates: AITaskStatus[] = [
        AITaskStatus.FAILED,
        AITaskStatus.CANCELLED,
        AITaskStatus.COMPLETED,
        AITaskStatus.PREPARING,
        AITaskStatus.CODING,
        AITaskStatus.TESTING,
        AITaskStatus.FIXING,
        AITaskStatus.REVIEWING,
        AITaskStatus.CREATING_PR,
      ];
      if (resetableStates.includes(task.status)) {
        this.logger.warn(
          `Task ${taskId} found in state ${task.status} at job start — resetting to QUEUED for retry.`,
        );
        await this.prisma.aITask.update({
          where: { id: taskId },
          data: { status: AITaskStatus.QUEUED, failureReason: null, currentStep: null },
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

      // ── Step 4b: Seed missing config files to prevent interactive prompts ──
      // If the repo lacks .eslintrc.json, next lint will ask interactive questions.
      // Seed a minimal config so CI=true lint runs without prompting.
      await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && [ ! -f .eslintrc.json ] && [ ! -f .eslintrc.js ] && [ ! -f .eslintrc.cjs ] && [ -f package.json ] && node -e "const p=require('./package.json'); if(p.dependencies&&p.dependencies.next||p.devDependencies&&p.devDependencies.next){require('fs').writeFileSync('.eslintrc.json',JSON.stringify({extends:'next/core-web-vitals'},null,2))}" 2>/dev/null || true`,
      );

      // ── Step 4c: Pre-flight build check — capture baseline errors ──────────
      // We run build on the ORIGINAL code to capture any pre-existing errors.
      // After AI modifies files, we only fail if NEW errors are introduced.
      // This way, pre-existing issues unrelated to the current task don't block.
      this.logger.log(`Running pre-flight baseline check for task ${taskId}`);
      const preflightResult = await this.runBuildOnly(containerId);
      const baselineErrors = preflightResult.passed ? [] : this.extractErrorLines(preflightResult.output);

      if (!preflightResult.passed) {
        this.logger.warn(
          `Pre-flight: ${baselineErrors.length} pre-existing build error(s) found. ` +
          `These will be ignored if unchanged after AI coding.`,
        );
        await this.activityService.log({
          organizationId, projectId, issueId, taskId,
          eventType: 'ERROR',
          friendlyMessage: `Dự án gốc có ${baselineErrors.length} lỗi build sẵn có. AI sẽ bỏ qua các lỗi này nếu không liên quan đến task.`,
          technicalDetail: { baselineErrors: baselineErrors.slice(0, 20) },
          actorId: 'system',
        });
      }

      await this.prisma.aITask.update({
        where: { id: taskId },
        data: {
          buildResult: {
            preflightBaseline: baselineErrors,
            preflightPassed: preflightResult.passed,
          },
        },
      });

      // ── Step 5: Create AI branch ──────────────────────────────────────────
      // Branch name: use only task short ID to avoid Unicode/length issues
      // Format: ai/{8-char-taskId} — safe, unique, no special chars
      const issueShortId = issue.id.substring(0, 8);
      const taskShortId = taskId.substring(0, 8);
      branchName = `ai/${issueShortId}-${taskShortId}`;

      // Clean up stale refs/heads/ai directory and lock files
      const localWorkdirForCleanup = (this.sandbox as unknown as { localWorkdirs?: Map<string, string> })
        .localWorkdirs?.get(containerId);
      if (localWorkdirForCleanup) {
        const gitRefsDir = path.join(localWorkdirForCleanup, 'workspace', 'repo', '.git', 'refs', 'heads');
        try {
          // Remove entire ai/ subdirectory under refs/heads to clear any corrupt state
          const aiRefsDir = path.join(gitRefsDir, 'ai');
          if (fs.existsSync(aiRefsDir)) {
            fs.rmSync(aiRefsDir, { recursive: true, force: true });
            this.logger.debug(`Cleaned up stale ai refs dir: ${aiRefsDir}`);
          }
          // Also remove any .lock files
          const removeLocks = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) removeLocks(fullPath);
              else if (entry.name.endsWith('.lock')) { fs.unlinkSync(fullPath); }
            }
          };
          removeLocks(path.join(localWorkdirForCleanup, 'workspace', 'repo', '.git'));
        } catch { /* ignore */ }
      }

      // Also delete remote tracking refs ai/* to prevent conflict with local branch creation
      await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && git for-each-ref --format='%(refname:short)' refs/remotes/origin/ai/ | xargs -I{} git branch -dr {} 2>/dev/null || true`,
      );
      // Remove packed-refs entries for ai/ branches
      await this.sandbox.exec(
        containerId,
        `cd /workspace/repo && sed -i.bak '/refs\\/heads\\/ai\\//d' .git/packed-refs 2>/dev/null || true`,
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

      // Mark issue as IN_PROGRESS so FE shows the right state
      await this.prisma.issue.update({
        where: { id: issueId },
        data: { status: 'IN_PROGRESS' },
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

      // Load rulebook for this project's tech stack
      const rulebook = this.rulebookService.fromStored(projectAnalysis?.rulebook)
        ?? this.rulebookService.fromFrameworks(projectAnalysis?.frameworks ?? []);
      const rulebookRules = rulebook.codingRules;

      this.logger.log(
        `Using rulebook for ${rulebook.detectedTech.join(', ')} (${rulebookRules.length} chars of rules)`,
      );

      // Load organization for AI output language preference
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { aiOutputLanguage: true },
      });
      const aiOutputLanguage = org?.aiOutputLanguage ?? 'en';

      // ── Step 6b: Read knowledge branch context ────────────────────────────────
      const [knowledgeOwner, knowledgeRepo] = project.githubRepoFullName.split('/');
      const knowledgeContext = await this.knowledgeReaderAgent.readForCodingTask(
        knowledgeOwner,
        knowledgeRepo,
        organizationId,
        taskId,
      ).catch((err) => {
        this.logger.warn(`KnowledgeReaderAgent failed: ${String(err)} — proceeding without context`);
        return null;
      });

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

        // Validate filePath is not a directory path (trailing slash or no extension on a known dir)
        const normalizedFilePath = step.filePath.replace(/\/+$/, ''); // strip trailing slashes
        if (!normalizedFilePath || normalizedFilePath !== step.filePath.replace(/\/+$/, '')) {
          this.logger.warn(`Step ${step.order} has invalid filePath "${step.filePath}" — skipping`);
          await this.activityService.log({
            organizationId, projectId, issueId, taskId,
            eventType: 'ERROR',
            friendlyMessage: `Bỏ qua bước ${step.order}: đường dẫn file không hợp lệ "${step.filePath}"`,
            actorId: 'system',
          });
          continue;
        }
        // Reassign to normalised value for the rest of this iteration
        step.filePath = normalizedFilePath;

        // Read existing file content from sandbox (local mode: read from workdir)
        let existingContent: string | null = null;
        const localWorkdir = (this.sandbox as unknown as { localWorkdirs?: Map<string, string> })
          .localWorkdirs?.get(containerId);
        if (localWorkdir) {
          const fullPath = path.join(localWorkdir, 'workspace', 'repo', step.filePath);
          if (fs.existsSync(fullPath)) {
            // Guard: skip if path resolves to a directory
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              this.logger.warn(`Step ${step.order} filePath "${step.filePath}" resolves to a directory — skipping`);
              await this.activityService.log({
                organizationId, projectId, issueId, taskId,
                eventType: 'ERROR',
                friendlyMessage: `Bỏ qua bước ${step.order}: "${step.filePath}" là thư mục, không phải file`,
                actorId: 'system',
              });
              continue;
            }
            existingContent = fs.readFileSync(fullPath, 'utf8');
          }
        } else {
          // Docker mode: check it's a regular file before reading
          const typeCheck = await this.sandbox.exec(
            containerId,
            `[ -f /workspace/repo/${step.filePath} ] && echo "file" || echo "notfile"`,
          );
          if (typeCheck.stdout.trim() !== 'file') {
            this.logger.warn(`Step ${step.order} filePath "${step.filePath}" is not a regular file in sandbox — skipping`);
            await this.activityService.log({
              organizationId, projectId, issueId, taskId,
              eventType: 'ERROR',
              friendlyMessage: `Bỏ qua bước ${step.order}: "${step.filePath}" không phải là file hợp lệ`,
              actorId: 'system',
            });
            continue;
          }
          const readResult = await this.sandbox.exec(
            containerId,
            `cat /workspace/repo/${step.filePath} 2>/dev/null || echo ""`,
          );
          existingContent = readResult.stdout || null;
        }

        // Call CodingAgent to generate actual code
        const codeChange = await this.codingAgent.implementStep(step, existingContent, codeContext, aiOutputLanguage, rulebookRules, knowledgeContext);
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
      let lastErrorSignature = '';
      let lastSameErrorCount = 0;
      // Track files that AI generated identical content for — passed to next attempt's prompt
      let lastUnchangedFiles: string[] = [];

      while (!checksPass && fixAttempts <= MAX_FIX_ATTEMPTS) {
        const testResult = await this.runChecks(containerId, organizationId, projectId, issueId, taskId);
        lastTestOutput = testResult.output;

        // Compare new errors against baseline — only NEW errors introduced by AI count
        if (testResult.passed) {
          checksPass = true;
        } else {
          const currentErrors = this.extractErrorLines(testResult.output);
          const newErrors = this.findNewErrors(baselineErrors, currentErrors);
          checksPass = newErrors.length === 0;
          if (!checksPass) {
            lastTestOutput = `NEW ERRORS (not in baseline):\n${newErrors.join('\n')}\n\nFULL BUILD OUTPUT:\n${testResult.output}`;
            this.logger.warn(`Task ${taskId} attempt ${fixAttempts + 1}: ${newErrors.length} new error(s):\n${newErrors.slice(0, 5).join('\n')}`);
          }
        }

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

          // On subsequent fix attempts the task is already in FIXING state.
          // The valid cycle is FIXING → TESTING → FIXING, so we transition back
          // to TESTING first (to reset the state) before entering FIXING again.
          // On the very first fix attempt the task is in TESTING, so no reset needed.
          const currentTask = await this.prisma.aITask.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (currentTask?.status === AITaskStatus.FIXING) {
            await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
              currentStep: `Chuẩn bị sửa lỗi lần ${fixAttempts}/${MAX_FIX_ATTEMPTS}`,
            });
          }
          await this.aiTasksService.transitionStatus(taskId, AITaskStatus.FIXING, organizationId, {
            currentStep: `Sửa lỗi build lần ${fixAttempts}/${MAX_FIX_ATTEMPTS}`,
          });

          // Build the list of ALL changed files with their current content
          const filesForFix: Array<{ filePath: string; content: string }> = [];
          const localWorkdirForFix = (this.sandbox as unknown as { localWorkdirs?: Map<string, string> })
            .localWorkdirs?.get(containerId);

          for (const fp of changedFiles) {
            let content = '';
            if (localWorkdirForFix) {
              const fullPath = path.join(localWorkdirForFix, 'workspace', 'repo', fp);
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                content = fs.readFileSync(fullPath, 'utf8');
              }
            } else {
              const readResult = await this.sandbox.exec(
                containerId,
                `[ -f /workspace/repo/${fp} ] && cat /workspace/repo/${fp} 2>/dev/null || echo ""`,
              );
              content = readResult.stdout ?? '';
            }
            if (content) filesForFix.push({ filePath: fp, content });
          }

          // Get the repo file tree using git ls-files — automatically respects .gitignore
          // This is far more reliable than hardcoding exclude lists
          const repoFileTree: string[] = [];
          if (localWorkdirForFix) {
            const repoRoot = path.join(localWorkdirForFix, 'workspace', 'repo');
            try {
              const { execSync } = await import('child_process');
              const lsOutput = execSync('git ls-files --cached --others --exclude-standard', {
                cwd: repoRoot,
                encoding: 'utf8',
                timeout: 10_000,
              });
              repoFileTree.push(...lsOutput.split('\n').map(l => l.trim()).filter(Boolean));
              this.logger.debug(`git ls-files: ${repoFileTree.length} tracked files`);
            } catch (gitErr) {
              // Fallback: manual walk if git fails (e.g. non-git repo in sandbox)
              this.logger.warn(`git ls-files failed (${String(gitErr)}) — falling back to manual walk`);
              const walk = (dir: string, prefix = '') => {
                if (!fs.existsSync(dir)) return;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                  if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) continue;
                  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                  if (entry.isDirectory()) { walk(path.join(dir, entry.name), rel); }
                  else { repoFileTree.push(rel); }
                }
              };
              walk(repoRoot);
            }
          }

          // Extract just the NEW error signatures for targeted fixing
          const currentErrors = this.extractErrorLines(testResult.output);
          const newErrorsForFix = this.findNewErrors(baselineErrors, currentErrors);

          // If the same error signature repeats 3 times in a row, the AI is truly stuck.
          // Strip stack paths (node_modules/...) to get a stable signature — otherwise
          // the minified Next.js chunk path makes every attempt look identical.
          // Allow up to 2 same-error retries before giving up (AI may try different strategies).
          const normalizeForSig = (e: string) => e.replace(/\(.*?\)/g, '').replace(/at \S+/g, '').trim();
          const currentErrorSignature = newErrorsForFix.slice(0, 3).map(normalizeForSig).join('|');
          const sameErrorCount = (currentErrorSignature && currentErrorSignature === lastErrorSignature)
            ? (lastSameErrorCount + 1)
            : 0;
          lastSameErrorCount = sameErrorCount;
          lastErrorSignature = currentErrorSignature;

          this.logger.log(
            `[FIX-LOOP] attempt=${fixAttempts}/${MAX_FIX_ATTEMPTS} ` +
            `errorSig="${currentErrorSignature.substring(0, 80)}" ` +
            `sameErrCount=${sameErrorCount} ` +
            `newErrCount=${newErrorsForFix.length}`,
          );

          if (sameErrorCount >= 4) {
            throw new Error(
              `AI lặp lại lỗi cũ sau ${fixAttempts} lần sửa mà không có tiến triển. Lỗi: ${newErrorsForFix.slice(0, 2).map(e => e.substring(0, 120)).join('; ')}`,
            );
          }
          // Log the actual error signatures for debugging
          this.logger.warn(
            `Fix attempt ${fixAttempts}: new errors:\n${newErrorsForFix.join('\n')}\n` +
            `Full build section:\n${testResult.output.split('---').pop()?.substring(0, 1000) ?? ''}`,
          );

          // Fallback: if signature parsing yielded nothing useful, use raw build output lines
          let errorsToFix = newErrorsForFix.length > 0
            ? newErrorsForFix
            : testResult.output
                .split('\n')
                .filter(l => l.includes('Error') || l.includes('error') || l.includes('Failed'))
                .slice(0, 20)
                .map(l => l.trim())
                .filter(l => l.length > 10);

          // ── Phase 1: Diagnose — classify error, trace stack, find root-cause files ──
          const diagnosis = await this.codingAgent.diagnoseBuildErrors(
            newErrorsForFix.length > 0 ? newErrorsForFix : errorsToFix,
            repoFileTree,
            codeContext,
            testResult.output,
          );

          this.logger.log(
            `Fix attempt ${fixAttempts} diagnosis: type=${diagnosis.errorType}, ` +
            `rootCause="${diagnosis.rootCause}", ` +
            `affectedFiles=[${diagnosis.affectedFiles.join(', ')}]`,
          );

          // ── Look up known solutions from previous successful fixes ──────────
          const knownSolutions = await this.failureLearner.getKnownSolutions(
            (currentErrorSignature || errorsToFix[0]) ?? '',
            codeContext.framework,
          );
          if (knownSolutions.length > 0) {
            this.logger.log(`Found ${knownSolutions.length} known solution(s) for this error type`);
            // Prepend known solutions to errorsToFix so they appear in the fix prompt
            errorsToFix = [
              `KNOWN SOLUTIONS FROM PREVIOUS FIXES:\n${knownSolutions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
              ...errorsToFix,
            ];
          }

          // ── Expand context: diagnosis-identified files + grep source for context hooks ──
          // Previously only files the AI touched were loaded. Now we also load:
          // 1. Files the diagnosis identified as root cause
          // 2. All source files that call context hooks (useTheme, useContext, etc.)
          //    so the AI can see which ones are missing "use client"

          const addFileToCtx = (filePath: string, label: string) => {
            if (filesForFix.some(f => f.filePath === filePath)) return;
            if (!localWorkdirForFix) return;
            const fullPath = path.join(localWorkdirForFix, 'workspace', 'repo', filePath);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              const content = fs.readFileSync(fullPath, 'utf8');
              if (content) {
                filesForFix.push({ filePath, content });
                this.logger.log(`Added ${label} file to fix context: ${filePath}`);
              }
            }
          };

          // Step 1: add diagnosis-identified root-cause files
          for (const diagFile of diagnosis.affectedFiles) {
            addFileToCtx(diagFile, 'diagnosis-identified');
          }

          // ── FULL SOURCE SCAN: load all source files from key dirs ──────────────
          // Use repoFileTree (from git ls-files) as the source of truth — already gitignore-aware.
          // This avoids loading example-ui, generated files, and other noise.
          if (localWorkdirForFix) {
            const repoRoot = path.join(localWorkdirForFix, 'workspace', 'repo');
            const FULL_SCAN_DIRS = ['src', 'app', 'components', 'lib', 'hooks', 'providers', 'context', 'store', 'stores', 'utils', 'types'];
            const MAX_FILE_SIZE = 50_000; // 50KB — skip huge files
            const MAX_TOTAL_FILES = 80;   // cap to avoid token overflow

            const fullScanFiles: Array<{ filePath: string; content: string }> = [];

            // Filter repoFileTree to only source files in relevant dirs
            const candidateFiles = repoFileTree.filter(rel =>
              /\.(tsx?|jsx?|css|json)$/.test(rel) &&
              FULL_SCAN_DIRS.some(d => rel.startsWith(d + '/') || rel.startsWith(d + '\\')) &&
              !filesForFix.some(f => f.filePath === rel),
            );

            for (const rel of candidateFiles) {
              if (fullScanFiles.length >= MAX_TOTAL_FILES) break;
              try {
                const fullEntryPath = path.join(repoRoot, rel);
                const stat = fs.statSync(fullEntryPath);
                if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
                  const content = fs.readFileSync(fullEntryPath, 'utf8');
                  if (content) fullScanFiles.push({ filePath: rel, content });
                }
              } catch { /* skip unreadable */ }
            }

            // Add to filesForFix — AI now has full visibility
            filesForFix.push(...fullScanFiles);

            this.logger.log(`Full source scan: added ${fullScanFiles.length} source files to fix context (total: ${filesForFix.length})`);
          }

          // Step 2: for runtime/static-gen/context errors, scan src/ for files that use
          // context hooks. Use repoFileTree (gitignore-aware) instead of manual walk.
          if (
            localWorkdirForFix &&
            (diagnosis.errorType === 'runtime' ||
             diagnosis.errorType === 'static-generation' ||
             diagnosis.errorType === 'hydration' ||
             testResult.output.includes('useContext') ||
             testResult.output.includes('Cannot read properties of null') ||
             testResult.output.includes('_document'))
          ) {
            const repoRoot = path.join(localWorkdirForFix, 'workspace', 'repo');
            const srcDirs = ['src/app', 'src/components', 'src/providers', 'src/context', 'app', 'components'];
            const contextHookPattern = /use[A-Z]\w*(Theme|Context|Store|Mode|Dark|Light)/;
            const htmlDocImportPattern = /from ['"]next\/document['"]/;

            const violations: string[] = [];

            const scanFile = (rel: string, fullEntryPath: string) => {
              if (!/\.(tsx?|jsx?)$/.test(rel)) return;
              try {
                const content = fs.readFileSync(fullEntryPath, 'utf8');
                const hasHtmlImport = htmlDocImportPattern.test(content);
                const hasContextHook = contextHookPattern.test(content);
                const hasUseClient = content.includes('"use client"') || content.includes("'use client'");

                if (hasHtmlImport) {
                  violations.push(`${rel}: imports from next/document (App Router violation)`);
                }
                if (hasContextHook && !hasUseClient) {
                  violations.push(`${rel}: calls context hook without "use client"`);
                }

                if ((hasContextHook || hasHtmlImport) && !filesForFix.some(f => f.filePath === rel)) {
                  filesForFix.push({ filePath: rel, content });
                  this.logger.log(`Added context-hook/doc-import file to fix context: ${rel}`);
                }
              } catch { /* skip unreadable files */ }
            };

            // Use gitignore-aware repoFileTree — filters out example-ui, dist, etc. automatically
            const candidateSourceFiles = repoFileTree.filter(rel =>
              /\.(tsx?|jsx?)$/.test(rel) &&
              srcDirs.some(d => rel.startsWith(d + '/') || rel.startsWith(d + '\\')),
            );

            for (const rel of candidateSourceFiles) {
              scanFile(rel, path.join(repoRoot, rel));
            }

            if (violations.length > 0) {
              this.logger.warn(
                `Static-gen violations found in source:\n${violations.join('\n')}`,
              );
              // Inject violations into errorsToFix so the AI fix prompt has concrete targets
              for (const v of violations) {
                if (!errorsToFix.includes(v)) errorsToFix.push(v);
              }
            }
          }

          // ── Phase 2: Fix — armed with diagnosis, AI modifies only the right files ──
          // Ask CodingAgent to fix ALL errors holistically in one call
          const fixes = await this.codingAgent.fixBuildErrors(
            errorsToFix,
            filesForFix,
            repoFileTree,
            codeContext,
            aiOutputLanguage,
            testResult.output,
            rulebookRules,
            diagnosis,
            fixAttempts,
            lastUnchangedFiles,
          );

          // Bug 1: Guard against AI returning no fixes — skip rebuild to avoid wasted attempt
          if (fixes.length === 0) {
            this.logger.warn(`Fix attempt ${fixAttempts}: AI returned no fixes — skipping rebuild`);
            // Force a different strategy on next attempt by clearing error signature cache
            lastErrorSignature = '';
            lastSameErrorCount = 0;
            // Count this as a failed attempt toward MAX_FIX_ATTEMPTS
            if (fixAttempts >= MAX_FIX_ATTEMPTS) {
              throw new Error(`AI không thể tạo code sửa lỗi sau ${MAX_FIX_ATTEMPTS} lần thử.`);
            }
            continue; // skip rebuild, go to next fix attempt
          }

          // Write fixed/created files back to sandbox
          const writtenFiles: string[] = [];
          const skippedUnchangedFiles: string[] = [];

          for (const fix of fixes) {
            if (localWorkdirForFix) {
              const fullPath = path.join(localWorkdirForFix, 'workspace', 'repo', fix.filePath);
              // Ensure parent directory exists for CREATE operations
              fs.mkdirSync(path.dirname(fullPath), { recursive: true });

              // Read old content for diff logging
              const oldContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null;
              const oldHash = oldContent ? require('crypto').createHash('md5').update(oldContent).digest('hex').substring(0, 8) : 'N/A(new)';
              const newHash = require('crypto').createHash('md5').update(fix.content).digest('hex').substring(0, 8);
              const contentChanged = oldContent !== fix.content;

              fs.writeFileSync(fullPath, fix.content, 'utf8');

              if (contentChanged) {
                writtenFiles.push(fix.filePath);
                this.logger.log(
                  `[FIX-WRITE] attempt=${fixAttempts} type=${fix.type} file=${fix.filePath} ` +
                  `hash=${oldHash}→${newHash} size=${fix.content.length}B ` +
                  `preview="${fix.content.replace(/\s+/g, ' ').substring(0, 120)}..."`,
                );
              } else {
                skippedUnchangedFiles.push(fix.filePath);
                this.logger.warn(
                  `[FIX-UNCHANGED] attempt=${fixAttempts} file=${fix.filePath} ` +
                  `hash=${oldHash} — AI generated IDENTICAL content, file NOT changed!`,
                );
              }
            } else {
              const dirPath = fix.filePath.includes('/')
                ? fix.filePath.substring(0, fix.filePath.lastIndexOf('/'))
                : '';
              if (dirPath) {
                await this.sandbox.exec(containerId, `mkdir -p /workspace/repo/${dirPath}`);
              }
              const b64 = Buffer.from(fix.content).toString('base64');
              await this.sandbox.exec(
                containerId,
                `echo "${b64}" | base64 -d > /workspace/repo/${fix.filePath}`,
              );
              writtenFiles.push(fix.filePath);
              this.logger.log(
                `[FIX-WRITE] attempt=${fixAttempts} type=${fix.type} file=${fix.filePath} ` +
                `size=${fix.content.length}B (docker mode)`,
              );
            }
            // Track new files so they get committed
            if (fix.type === 'CREATE' && !changedFiles.includes(fix.filePath)) {
              changedFiles.push(fix.filePath);
            }
            this.logger.log(`Applied AI fix (${fix.type}) to ${fix.filePath} (attempt ${fixAttempts})`);
          }

          // Detailed summary: how many files actually changed vs were identical
          this.logger.log(
            `Fix attempt ${fixAttempts}: wrote ${fixes.length} file(s): ${fixes.map(f => f.filePath).join(', ')}`,
          );
          if (writtenFiles.length > 0) {
            this.logger.log(`[FIX-SUMMARY] attempt=${fixAttempts} CHANGED(${writtenFiles.length}): ${writtenFiles.join(', ')}`);
          }
          if (skippedUnchangedFiles.length > 0) {
            this.logger.warn(
              `[FIX-SUMMARY] attempt=${fixAttempts} UNCHANGED(${skippedUnchangedFiles.length}): ${skippedUnchangedFiles.join(', ')} ` +
              `— AI is stuck producing same output! Consider escalating strategy.`,
            );
          }
          // Persist for next attempt so AI knows which files it failed to change
          lastUnchangedFiles = skippedUnchangedFiles;

          // Record this fix attempt for future learning (async, best-effort)
          void this.failureLearner.recordFailure({
            taskId,
            organizationId,
            errorSignature: (currentErrorSignature || errorsToFix[0]?.substring(0, 200)) ?? '',
            framework: codeContext.framework,
            attemptedFix: fixes.map(f => `${f.type} ${f.filePath}`).join(', '),
            buildOutput: testResult.output,
            affectedFiles: fixes.map(f => f.filePath),
          });

          await this.aiTasksService.transitionStatus(taskId, AITaskStatus.TESTING, organizationId, {
            currentStep: `Chạy lại kiểm tra (lần ${fixAttempts + 1}/${MAX_FIX_ATTEMPTS})`,
          });
        }
      }

      this.logger.log(`Build checks passed for task ${taskId}, proceeding to commit`);

      // Record success for future learning if fixes were needed (async, best-effort)
      if (fixAttempts > 0) {
        void this.failureLearner.recordSuccess({
          taskId,
          organizationId,
          errorSignature: lastErrorSignature || '',
          framework: ((await this.prisma.projectAnalysis.findFirst({ where: { projectId } }))?.frameworks ?? ['unknown'])[0] ?? 'unknown',
          successfulFix: `Fixed after ${fixAttempts} attempt(s), changed files: ${changedFiles.slice(0, 10).join(', ')}`,
          filesFixed: changedFiles,
          attemptsNeeded: fixAttempts,
        });
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
   * Runs ONLY the build step on the current repo state.
   * Used for pre-flight baseline capture — no lint, no test.
   */
  private async runBuildOnly(
    containerId: string,
  ): Promise<{ passed: boolean; output: string }> {
    const result = await this.sandbox.exec(
      containerId,
      'cd /workspace/repo && [ -f package.json ] && NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 || echo "NO_BUILD_SCRIPT"',
      180_000,
    );
    const output = result.stdout ?? '';
    if (output.includes('NO_BUILD_SCRIPT')) {
      return { passed: true, output: 'No build script — skipped' };
    }
    return { passed: result.exitCode === 0, output };
  }

  /**
   * Extracts normalised error signatures from Next.js/TypeScript build output.
   * Used to diff baseline vs post-AI errors — only NEW errors trigger fix loop.
   *
   * Next.js error format:
   *   ./src/app/layout.tsx
   *   Type error: Argument of type ... (line X)
   *
   * We extract "filePath::ErrorMessage" as the signature, ignoring line numbers.
   */
  private extractErrorLines(output: string): string[] {
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
    const signatures: string[] = [];
    let currentFile = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // File reference line: starts with ./ or src/
      if (line.startsWith('./') || line.match(/^[a-zA-Z].*\.(tsx?|jsx?|css|mjs)$/)) {
        currentFile = line.replace(/^\.\//, '');
        continue;
      }

      // Error line patterns from Next.js / tsc
      const isError =
        line.startsWith('Type error:') ||
        line.startsWith('Error:') ||
        line.includes(': error TS') ||
        line.match(/^\d+:\d+\s+Error\s/) !== null ||
        line.includes('Cannot find') ||
        line.includes('is not assignable') ||
        line.includes('does not exist') ||
        line.includes('Module not found') ||
        line.includes('You\'re importing a component') ||
        line.includes('should not be imported outside') ||
        line.includes('TypeError:') ||
        line.includes('useContext') ||
        line.includes('Cannot read properties');

      if (isError) {
        // Strip line:col numbers to normalise across minor edits
        const normalised = line.replace(/\s*\(\d+,\d+\)/, '').replace(/:\s*\d+:\d+/, ':').trim();
        const sig = currentFile ? `${currentFile}::${normalised}` : normalised;
        // Skip empty/useless signatures like "foo.tsx::Error:" with nothing after
        if (sig.length > 20 && !sig.endsWith('::Error:') && !sig.endsWith('::Error')) {
          signatures.push(sig);
        }
      }
    }

    return [...new Set(signatures)]; // deduplicate
  }

  /**
   * Compares current errors against baseline.
   * Returns only errors that are genuinely NEW (not present in baseline).
   */
  private findNewErrors(baselineErrors: string[], currentErrors: string[]): string[] {
    return currentErrors.filter(curr => {
      // Check if this error is covered by baseline
      return !baselineErrors.some(base => {
        if (base === curr) return true;
        // Fuzzy match: same file + same error type (ignoring exact message details)
        const [baseFile, baseMsg] = base.split('::');
        const [currFile, currMsg] = curr.split('::');
        if (baseFile && currFile && baseFile === currFile) {
          // Same file — check if error type is the same (first 40 chars)
          const baseType = (baseMsg ?? '').substring(0, 40);
          const currType = (currMsg ?? '').substring(0, 40);
          return baseType === currType;
        }
        return false;
      });
    });
  }

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

    const commands: Array<{ cmd: string; label: string; required: boolean }> = [
      {
        cmd: 'cd /workspace/repo && [ -f package.json ] && npm install --prefer-offline 2>&1',
        label: 'npm install',
        required: true,
      },
      {
        // Run lint non-interactively. If ESLint isn't configured yet, skip gracefully.
        // NEXT_TELEMETRY_DISABLED=1 prevents Next.js from prompting for telemetry consent.
        // CI=true makes next lint non-interactive (skips ESLint setup wizard).
        cmd: 'cd /workspace/repo && [ -f package.json ] && CI=true NEXT_TELEMETRY_DISABLED=1 npm run lint 2>&1 < /dev/null',
        label: 'lint',
        required: false, // lint never blocks — only build does
      },
      {
        cmd: 'cd /workspace/repo && [ -f package.json ] && CI=true npm test -- --passWithNoTests 2>&1 < /dev/null',
        label: 'test',
        required: false,
      },
      {
        cmd: 'cd /workspace/repo && [ -f package.json ] && NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1',
        label: 'build',
        required: true, // build MUST pass — catches "use client" errors, type errors, etc.
      },
    ];

    for (const { cmd, label, required } of commands) {
      // Check if the npm script exists before running it
      const scriptName = label === 'npm install' ? null : label;
      let scriptExists = true;
      if (scriptName) {
        const checkResult = await this.sandbox.exec(
          containerId,
          `cd /workspace/repo && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['${scriptName}'] ? 0 : 1)" 2>/dev/null`,
        );
        scriptExists = checkResult.exitCode === 0;
      }

      if (!scriptExists) {
        outputs.push(`[${label}] skipped — script not defined in package.json`);
        continue;
      }

      const result = await this.sandbox.exec(containerId, cmd, 180_000);
      const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();

      // Detect interactive/setup prompts — if lint asks for config, treat as skip not failure
      const isInteractivePrompt =
        combinedOutput.includes('How would you like to configure') ||
        combinedOutput.includes('Would you like to') ||
        combinedOutput.includes('? ');

      if (isInteractivePrompt) {
        outputs.push(`[${label}] skipped — tool requires interactive setup (not configured in repo)`);
        this.logger.warn(`${label} requires interactive setup for task ${taskId} — skipping`);
        continue;
      }

      const summary = `[${label}] exit=${result.exitCode}\n${combinedOutput}`.trim();
      outputs.push(summary);

      // Only mark as failed if this step is required and actually ran and failed
      if (required && result.exitCode !== 0) {
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
          // Log full output for build failures so we can debug
          stdout: label === 'build' && result.exitCode !== 0
            ? result.stdout.substring(0, 3000)
            : result.stdout.substring(0, 1000),
          stderr: result.stderr.substring(0, 500),
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
