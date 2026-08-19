import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Octokit } from '@octokit/rest';
import { Inject } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { GithubService } from '../../modules/github/github.service';
import { AI_PROVIDER, IAIProvider } from '../../ai/providers/ai-provider.interface';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { HealthCheckJobData } from '../queue.types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface HealthIssue {
  category: 'build' | 'lint' | 'type' | 'security' | 'dependency' | 'config';
  severity: HealthIssueSeverity;
  title: string;
  detail: string;
  filePath?: string;
  line?: number;
  suggestedFix?: string;
  canAutoFix: boolean;
}

export interface HealthCheckResult {
  projectId: string;
  score: number;             // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: HealthIssue[];
  summary: string;
  scannedAt: string;
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner, repo, path: filePath,
    });
    if (Array.isArray(data) || data.type !== 'file') return null;
    if ('content' in data && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

function scoreFromIssues(issues: HealthIssue[]): number {
  let deduction = 0;
  for (const issue of issues) {
    if (issue.severity === 'critical') deduction += 25;
    else if (issue.severity === 'high') deduction += 12;
    else if (issue.severity === 'medium') deduction += 6;
    else if (issue.severity === 'low') deduction += 2;
  }
  return Math.max(0, 100 - deduction);
}

function gradeFromScore(score: number): HealthCheckResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Processor(QUEUES.HEALTH_CHECK, { concurrency: CONCURRENCY.HEALTH_CHECK })
export class HealthCheckWorker extends WorkerHost {
  private readonly logger = new Logger(HealthCheckWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {
    super();
  }

  async process(job: Job<HealthCheckJobData>): Promise<void> {
    const { projectId, organizationId, repoFullName, branch } = job.data;
    const [owner, repo] = repoFullName.split('/');
    const startedAt = Date.now();

    this.logger.log(`Starting health check for project ${projectId} (${repoFullName})`);

    try {
      // Mark as running
      await this.prisma.project.update({
        where: { id: projectId },
        data: { healthCheckStatus: 'RUNNING' },
      });

      const token = await this.githubService.getDecryptedToken(organizationId);
      const octokit = new Octokit({ auth: token });

      // ── Fetch key files ────────────────────────────────────────────────────
      const [packageJsonRaw, tsconfigRaw, nextConfigRaw] = await Promise.all([
        fetchFile(octokit, owner, repo, 'package.json'),
        fetchFile(octokit, owner, repo, 'tsconfig.json'),
        fetchFile(octokit, owner, repo, 'next.config.mjs').then(r => r ?? fetchFile(octokit, owner, repo, 'next.config.js')),
      ]);

      const issues: HealthIssue[] = [];

      // ── Check 1: package.json exists ──────────────────────────────────────
      if (!packageJsonRaw) {
        issues.push({
          category: 'config',
          severity: 'critical',
          title: 'package.json not found',
          detail: 'The project root does not contain a package.json file.',
          canAutoFix: false,
        });
      }

      let packageJson: Record<string, unknown> | null = null;
      if (packageJsonRaw) {
        try { packageJson = JSON.parse(packageJsonRaw); } catch { /* ignore */ }
      }

      const allDeps: Record<string, string> = {
        ...(packageJson?.dependencies as Record<string, string> ?? {}),
        ...(packageJson?.devDependencies as Record<string, string> ?? {}),
      };

      // ── Check 2: ESLint config ─────────────────────────────────────────────
      const eslintFiles = ['.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml'];
      const eslintChecks = await Promise.all(eslintFiles.map(f => fetchFile(octokit, owner, repo, f)));
      const hasEslintConfig = eslintChecks.some(c => c !== null);

      if (!hasEslintConfig && 'next' in allDeps) {
        issues.push({
          category: 'config',
          severity: 'medium',
          title: 'ESLint not configured',
          detail: 'No .eslintrc.json found. Running `next lint` will trigger an interactive setup wizard.',
          suggestedFix: 'Create .eslintrc.json with { "extends": "next/core-web-vitals" }',
          canAutoFix: true,
        });
      }

      // ── Check 3: TypeScript strict mode ───────────────────────────────────
      if (tsconfigRaw) {
        try {
          const tsconfig = JSON.parse(tsconfigRaw) as { compilerOptions?: { strict?: boolean; noUncheckedIndexedAccess?: boolean } };
          if (!tsconfig.compilerOptions?.strict) {
            issues.push({
              category: 'config',
              severity: 'low',
              title: 'TypeScript strict mode disabled',
              detail: 'compilerOptions.strict is not enabled. This allows many type errors to go undetected.',
              filePath: 'tsconfig.json',
              suggestedFix: 'Add "strict": true to compilerOptions in tsconfig.json',
              canAutoFix: true,
            });
          }
        } catch { /* ignore */ }
      }

      // ── Check 4: Audit vulnerable deps (from package.json versions) ────────
      const KNOWN_VULNERABLE: Record<string, { severity: HealthIssueSeverity; detail: string }> = {
        'lodash': { severity: 'high', detail: 'Prototype pollution vulnerability in versions < 4.17.21' },
        'axios': { severity: 'medium', detail: 'SSRF vulnerability in versions < 1.6.0' },
        'next': { severity: 'info', detail: 'Keep Next.js updated to latest stable for security patches' },
      };

      for (const [pkg, info] of Object.entries(KNOWN_VULNERABLE)) {
        if (pkg in allDeps) {
          const version = String(allDeps[pkg]).replace(/[\^~>=]/g, '');
          if (pkg === 'lodash' && version < '4.17.21') {
            issues.push({
              category: 'security',
              severity: info.severity,
              title: `Vulnerable dependency: ${pkg}@${allDeps[pkg]}`,
              detail: info.detail,
              suggestedFix: `Update to latest: npm install ${pkg}@latest`,
              canAutoFix: false,
            });
          }
        }
      }

      // ── Check 5: Missing scripts ───────────────────────────────────────────
      const scripts = (packageJson?.scripts as Record<string, string>) ?? {};
      const importantScripts = ['build', 'test', 'lint'];
      for (const script of importantScripts) {
        if (!(script in scripts)) {
          issues.push({
            category: 'config',
            severity: 'low',
            title: `Missing npm script: "${script}"`,
            detail: `No "${script}" script defined in package.json. CI/CD pipelines may fail.`,
            suggestedFix: `Add a "${script}" script to package.json`,
            canAutoFix: false,
          });
        }
      }

      // ── Check 6: AI-powered deep analysis ─────────────────────────────────
      // Get the stored file tree from project analysis for AI to review
      const projectAnalysis = await this.prisma.projectAnalysis.findUnique({
        where: { projectId },
      });

      const directoryStructure = projectAnalysis?.directoryStructure as {
        fileTree?: string[];
        readmeSnippet?: string | null;
      } | null;

      const fileTree = directoryStructure?.fileTree ?? [];

      if (fileTree.length > 0) {
        try {
          const aiIssues = await this.runAIHealthAnalysis(
            repoFullName,
            packageJsonRaw ?? '',
            tsconfigRaw ?? '',
            fileTree,
            issues,
          );
          issues.push(...aiIssues);
        } catch (aiErr) {
          this.logger.warn(`AI health analysis failed for ${projectId}: ${String(aiErr)}`);
        }
      }

      // ── Score & persist ────────────────────────────────────────────────────
      const score = scoreFromIssues(issues);
      const grade = gradeFromScore(score);
      const durationMs = Date.now() - startedAt;

      const summary = this.buildSummary(score, grade, issues);

      const result: HealthCheckResult = {
        projectId,
        score,
        grade,
        issues,
        summary,
        scannedAt: new Date().toISOString(),
        durationMs,
      };

      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          healthCheckStatus: 'DONE',
          healthCheckResult: result as unknown as import('@prisma/client').Prisma.JsonObject,
          healthCheckedAt: new Date(),
        },
      });

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          projectId,
          eventType: 'STATE_CHANGE',
          friendlyMessage: `Health check hoàn tất: điểm ${score}/100 (${grade}), phát hiện ${issues.length} vấn đề.`,
          actorId: 'system',
        },
      });

      this.logger.log(`Health check done for ${projectId}: score=${score} grade=${grade} issues=${issues.length}`);
    } catch (err) {
      this.logger.error(`Health check failed for ${projectId}`, err instanceof Error ? err.stack : String(err));

      await this.prisma.project.update({
        where: { id: projectId },
        data: { healthCheckStatus: 'FAILED' },
      }).catch(() => {/* ignore */});
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async runAIHealthAnalysis(
    repoFullName: string,
    packageJsonContent: string,
    tsconfigContent: string,
    fileTree: string[],
    existingIssues: HealthIssue[],
  ): Promise<HealthIssue[]> {
    const existingSummary = existingIssues.map(i => `- [${i.severity}] ${i.title}`).join('\n');

    const systemPrompt = `You are a senior software architect performing a codebase health check.
Analyze the provided project metadata and identify health issues.
Return ONLY a JSON array of issue objects. No markdown, no explanation.`;

    const userPrompt = `Repository: ${repoFullName}

FILE TREE (sample):
${fileTree.slice(0, 100).join('\n')}

package.json:
${packageJsonContent.substring(0, 2000)}

tsconfig.json:
${tsconfigContent.substring(0, 1000)}

ALREADY DETECTED ISSUES (do not duplicate):
${existingSummary || 'none'}

Identify up to 5 additional health issues not already listed above.
For each issue return:
{
  "category": "build"|"lint"|"type"|"security"|"dependency"|"config",
  "severity": "critical"|"high"|"medium"|"low"|"info",
  "title": string,
  "detail": string,
  "filePath": string|null,
  "suggestedFix": string|null,
  "canAutoFix": boolean
}

Return a JSON array. If no additional issues found, return [].`;

    const response = await this.aiProvider.call<unknown>(systemPrompt, userPrompt, {
      maxTokens: 1500,
      temperature: 0.1,
    });

    const content = response.content;
    if (!Array.isArray(content)) return [];

    return (content as HealthIssue[]).filter(
      i => i.category && i.severity && i.title && i.detail,
    );
  }

  private buildSummary(score: number, grade: string, issues: HealthIssue[]): string {
    const critical = issues.filter(i => i.severity === 'critical').length;
    const high = issues.filter(i => i.severity === 'high').length;
    const medium = issues.filter(i => i.severity === 'medium').length;

    if (score >= 90) return `Dự án có sức khoẻ tốt (${grade}). ${issues.length === 0 ? 'Không phát hiện vấn đề nào.' : `Có ${issues.length} vấn đề nhỏ cần chú ý.`}`;
    if (critical > 0) return `Phát hiện ${critical} vấn đề nghiêm trọng cần xử lý ngay. Điểm: ${score}/100 (${grade}).`;
    if (high > 0) return `Phát hiện ${high} vấn đề quan trọng và ${medium} vấn đề trung bình. Điểm: ${score}/100 (${grade}).`;
    return `Dự án có một số vấn đề cần cải thiện. Điểm: ${score}/100 (${grade}). ${issues.length} vấn đề được phát hiện.`;
  }
}
