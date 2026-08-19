import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Octokit } from '@octokit/rest';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GithubService } from '../../modules/github/github.service';
import { AnalysisAgent } from '../../ai/agents/analysis.agent';
import { PlanningAgent } from '../../ai/agents/planning.agent';
import { PricingService } from '../../modules/pricing/pricing.service';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { AIAnalysisJobData } from '../queue.types';

// Default divisor for spreading baseline cost across issues (MVP)
const BASELINE_COST_ISSUE_DIVISOR = 10;

// Max chars to include per file in planning context (keeps token usage bounded)
const MAX_FILE_CONTENT_CHARS = 3_000;

// Max number of affected files to fetch content for
const MAX_FILES_TO_READ = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      { owner, repo, path },
    );
    if (Array.isArray(data) || data.type !== 'file') return null;
    if ('content' in data && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null; // file not found or unreadable — skip silently
  }
}

@Processor(QUEUES.AI_ANALYSIS, { concurrency: CONCURRENCY.AI_ANALYSIS })
export class AIAnalysisWorker extends WorkerHost {
  private readonly logger = new Logger(AIAnalysisWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    private readonly analysisAgent: AnalysisAgent,
    private readonly planningAgent: PlanningAgent,
    private readonly pricingService: PricingService,
  ) {
    super();
  }

  async process(job: Job<AIAnalysisJobData>): Promise<void> {
    const { issueId, organizationId } = job.data;

    this.logger.log(`Starting AI analysis for issue ${issueId}`);

    try {
      // ── Step 1: Load Issue, Project, and ProjectAnalysis from DB ────────
      const issue = await this.prisma.issue.findUnique({
        where: { id: issueId },
        include: { project: { select: { githubRepoFullName: true, defaultBranch: true } } },
      });

      if (!issue) {
        throw new Error(`Issue ${issueId} not found`);
      }

      const projectAnalysis = await this.prisma.projectAnalysis.findUnique({
        where: { projectId: issue.projectId },
      });

      // Load organization for AI output language preference
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { aiOutputLanguage: true },
      });
      const language = org?.aiOutputLanguage ?? 'en';

      // ── Step 2: Build ProjectContext for AnalysisAgent ──────────────────
      const rawDirectoryStructure = projectAnalysis?.directoryStructure as {
        fileTree?: string[];
        readmeSnippet?: string | null;
        [key: string]: unknown;
      } | null ?? null;

      const projectContext = {
        primaryLanguage: projectAnalysis?.primaryLanguage ?? null,
        frameworks: projectAnalysis?.frameworks ?? [],
        detectedModules: (projectAnalysis?.detectedModules as unknown[]) ?? [],
        mainDependencies: (projectAnalysis?.mainDependencies as unknown[]) ?? [],
        buildScripts: projectAnalysis?.buildScripts ?? null,
        directoryStructure: rawDirectoryStructure,
      };

      // ── Step 3: Run AnalysisAgent — identifies affectedFiles ────────────
      const { result: analysisResult, tokensUsed: analysisTokens, costUsd: analysisCost } =
        await this.analysisAgent.analyze(
          {
            title: issue.title,
            description: issue.description,
            type: issue.type,
            priority: issue.priority,
          },
          projectContext,
          language,
        );

      this.logger.log(
        `Analysis complete for issue ${issueId}: complexity=${analysisResult.complexity}, risk=${analysisResult.riskLevel}, affectedFiles=${analysisResult.affectedFiles.length}`,
      );

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          issueId,
          projectId: issue.projectId,
          eventType: 'AI_CALL',
          agentType: 'AnalysisAgent',
          friendlyMessage: `AnalysisAgent hoàn tất. Token thực tế: ${analysisTokens}. Chi phí: $${analysisCost.toFixed(4)}.`,
          tokensUsed: analysisTokens,
          estimatedCost: analysisCost,
          actorId: 'system',
        },
      });

      // ── Step 4: READ affected files from GitHub (Read-then-Plan) ────────
      // This is the key step that makes plans accurate: fetch actual file
      // content so the planning agent sees real code, not just file names.
      const fileContents: Record<string, string> = {};

      if (issue.project && analysisResult.affectedFiles.length > 0) {
        const [owner, repo] = issue.project.githubRepoFullName.split('/');
        const branch = issue.project.defaultBranch;

        try {
          const token = await this.githubService.getDecryptedToken(organizationId);
          const octokit = new Octokit({ auth: token });

          const filesToRead = analysisResult.affectedFiles.slice(0, MAX_FILES_TO_READ);

          await Promise.all(
            filesToRead.map(async (filePath) => {
              const content = await fetchFileContent(octokit, owner, repo, filePath);
              if (content) {
                // Truncate to avoid token explosion; preserve the beginning (imports + structure)
                fileContents[filePath] = content.length > MAX_FILE_CONTENT_CHARS
                  ? content.slice(0, MAX_FILE_CONTENT_CHARS) + '\n... [truncated]'
                  : content;
              }
            }),
          );

          this.logger.log(
            `Read ${Object.keys(fileContents).length}/${filesToRead.length} affected files from ${issue.project.githubRepoFullName} (branch: ${branch})`,
          );
        } catch (readErr) {
          // Non-fatal — planning continues without file content
          this.logger.warn(`Failed to read affected files for issue ${issueId}: ${String(readErr)}`);
        }
      }

      // ── Step 5: Run PlanningAgent with real file content ────────────────
      const { result: implementationPlan, tokensUsed: planningTokens, costUsd: planningCost } =
        await this.planningAgent.plan(
          {
            title: issue.title,
            description: issue.description,
            type: issue.type,
          },
          analysisResult,
          language,
          fileContents,
        );

      this.logger.log(
        `Planning complete for issue ${issueId}: ${implementationPlan.steps.length} steps`,
      );

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          issueId,
          projectId: issue.projectId,
          eventType: 'AI_CALL',
          agentType: 'PlanningAgent',
          friendlyMessage: `PlanningAgent hoàn tất. Token thực tế: ${planningTokens}. Chi phí: $${planningCost.toFixed(4)}.`,
          tokensUsed: planningTokens,
          estimatedCost: planningCost,
          actorId: 'system',
        },
      });

      // ── Step 6: Calculate pricing ────────────────────────────────────────
      const costEstimateData = this.pricingService.calculate({
        complexity: analysisResult.complexity,
        estimatedTokens: implementationPlan.estimatedTokens,
        estimatedSteps: implementationPlan.steps.length,
        risk: analysisResult.riskLevel,
        projectSizeKb: 0,
      });

      const baselineCostIncluded = (projectAnalysis?.baselineCostUsd ?? 0) / BASELINE_COST_ISSUE_DIVISOR;

      // ── Step 7: Persist results (transaction) ────────────────────────────
      await this.prisma.$transaction([
        this.prisma.issue.update({
          where: { id: issueId },
          data: {
            status: 'PLAN_READY',
            aiDiagnosis: analysisResult.aiDiagnosis,
            affectedFiles: analysisResult.affectedFiles,
            riskLevel: analysisResult.riskLevel,
            complexity: analysisResult.complexity,
            feasibilityNotes: analysisResult.feasibilityNotes,
            implementationPlan: implementationPlan as unknown as Prisma.JsonObject,
          },
        }),
        this.prisma.costEstimate.upsert({
          where: { issueId },
          create: { issueId, organizationId, baselineCostIncluded, ...costEstimateData },
          update: { baselineCostIncluded, ...costEstimateData },
        }),
      ]);

      this.logger.log(`Persisted analysis results for issue ${issueId}`);

      // ── Step 8: Log combined ActivityLog entry ───────────────────────────
      const totalActualTokens = analysisTokens + planningTokens;
      const totalActualCost = analysisCost + planningCost;

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          issueId,
          projectId: issue.projectId,
          eventType: 'AI_CALL',
          agentType: 'AIAnalysisAgent',
          friendlyMessage: `Phân tích AI hoàn tất. Token thực tế: ${totalActualTokens} (ước tính: ${implementationPlan.estimatedTokens}). Chi phí phân tích: $${totalActualCost.toFixed(4)}.`,
          tokensUsed: totalActualTokens,
          estimatedCost: totalActualCost,
          actorId: 'system',
        },
      });

      this.logger.log(`AI analysis completed for issue ${issueId}`);
    } catch (err: unknown) {
      this.logger.error(
        `AI analysis failed for issue ${issueId}`,
        err instanceof Error ? err.stack : String(err),
      );

      await this.prisma.issue.update({
        where: { id: issueId },
        data: { status: 'ANALYSIS_FAILED' },
      });

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          issueId,
          eventType: 'ERROR',
          friendlyMessage:
            'AI không thể phân tích yêu cầu của bạn. Vui lòng kiểm tra lại mô tả và thử lại.',
          technicalDetail: { error: String(err) },
          actorId: 'system',
        },
      });

      throw err;
    }
  }
}
