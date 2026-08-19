import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalysisAgent } from '../../ai/agents/analysis.agent';
import { PlanningAgent } from '../../ai/agents/planning.agent';
import { PricingService } from '../../modules/pricing/pricing.service';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { AIAnalysisJobData } from '../queue.types';

// Default divisor for spreading baseline cost across issues (MVP)
const BASELINE_COST_ISSUE_DIVISOR = 10;

@Processor(QUEUES.AI_ANALYSIS, { concurrency: CONCURRENCY.AI_ANALYSIS })
export class AIAnalysisWorker extends WorkerHost {
  private readonly logger = new Logger(AIAnalysisWorker.name);

  constructor(
    private readonly prisma: PrismaService,
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
      // ── Step 1: Load Issue and ProjectAnalysis from DB ──────────────────
      const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });

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

      // ── Step 2: Build ProjectContext for AI agents ──────────────────────
      // Handle the case where projectAnalysis is null (no analysis yet) — use empty context
      const projectContext = {
        primaryLanguage: projectAnalysis?.primaryLanguage ?? null,
        frameworks: projectAnalysis?.frameworks ?? [],
        detectedModules: (projectAnalysis?.detectedModules as unknown[]) ?? [],
        mainDependencies: (projectAnalysis?.mainDependencies as unknown[]) ?? [],
        buildScripts: projectAnalysis?.buildScripts ?? null,
      };

      // ── Step 3: Run AnalysisAgent ─────────────────────────────────────
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
        `Analysis complete for issue ${issueId}: complexity=${analysisResult.complexity}, risk=${analysisResult.riskLevel}`,
      );

      // Log AnalysisAgent actual token usage
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

      // ── Step 4: Run PlanningAgent ──────────────────────────────────────
      const { result: implementationPlan, tokensUsed: planningTokens, costUsd: planningCost } =
        await this.planningAgent.plan(
          {
            title: issue.title,
            description: issue.description,
            type: issue.type,
          },
          analysisResult,
          language,
        );

      this.logger.log(
        `Planning complete for issue ${issueId}: ${implementationPlan.steps.length} steps`,
      );

      // Log PlanningAgent actual token usage
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

      // ── Step 5: Calculate pricing ──────────────────────────────────────
      const costEstimateData = this.pricingService.calculate({
        complexity: analysisResult.complexity,
        estimatedTokens: implementationPlan.estimatedTokens,
        estimatedSteps: implementationPlan.steps.length,
        risk: analysisResult.riskLevel,
        projectSizeKb: 0, // not available at this stage
      });

      // Spread project baseline cost across estimated issues (MVP: divide by 10)
      const baselineCostIncluded = (projectAnalysis?.baselineCostUsd ?? 0) / BASELINE_COST_ISSUE_DIVISOR;

      // ── Step 6: Persist results to DB (transaction) ────────────────────
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

      // ── Step 7: Log combined ActivityLog entry ─────────────────────────
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

      // Update issue status to ANALYSIS_FAILED
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

      // Re-throw so BullMQ handles retry
      throw err;
    }
  }
}
