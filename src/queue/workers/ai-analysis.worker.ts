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
      const analysisResult = await this.analysisAgent.analyze(
        {
          title: issue.title,
          description: issue.description,
          type: issue.type,
          priority: issue.priority,
        },
        projectContext,
      );

      this.logger.log(
        `Analysis complete for issue ${issueId}: complexity=${analysisResult.complexity}, risk=${analysisResult.riskLevel}`,
      );

      // ── Step 4: Run PlanningAgent ──────────────────────────────────────
      const implementationPlan = await this.planningAgent.plan(
        {
          title: issue.title,
          description: issue.description,
          type: issue.type,
        },
        analysisResult,
      );

      this.logger.log(
        `Planning complete for issue ${issueId}: ${implementationPlan.steps.length} steps`,
      );

      // ── Step 5: Calculate pricing ──────────────────────────────────────
      const costEstimateData = this.pricingService.calculate({
        complexity: analysisResult.complexity,
        estimatedTokens: implementationPlan.estimatedTokens,
        estimatedSteps: implementationPlan.steps.length,
        risk: analysisResult.riskLevel,
        projectSizeKb: 0, // not available at this stage
      });

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
          create: { issueId, organizationId, ...costEstimateData },
          update: { ...costEstimateData },
        }),
      ]);

      this.logger.log(`Persisted analysis results for issue ${issueId}`);

      // ── Step 7: Log to ActivityLog ─────────────────────────────────────
      await this.prisma.activityLog.create({
        data: {
          organizationId,
          issueId,
          projectId: issue.projectId,
          eventType: 'AI_CALL',
          agentType: 'AIAnalysisAgent',
          friendlyMessage: `Phân tích hoàn tất. Độ phức tạp: ${analysisResult.complexity}. Ước tính chi phí: $${costEstimateData.customerPriceBase}.`,
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
