import {
  Injectable,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { GithubService } from '../github/github.service';
import {
  KnowledgeStatusDto,
  KnowledgeAnalysisStatus,
  DocumentStatus,
  KnowledgeDocumentName,
} from './types/knowledge.types';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly githubService: GithubService,
  ) {}

  /**
   * Validates ownership, guards against duplicate running jobs, then enqueues
   * a knowledge analysis job for the given project.
   */
  async enqueueAnalysis(
    projectId: string,
    organizationId: string,
    force: boolean,
  ): Promise<void> {
    // 1. Verify the project belongs to the organisation
    await this.validateProjectOwnership(projectId, organizationId);

    // 2. Guard against duplicate concurrent jobs
    const running = await this.checkRunning(projectId);
    if (running) {
      throw new ConflictException(
        'Phân tích kiến trúc đang chạy cho dự án này. Vui lòng đợi hoàn tất.',
      );
    }

    // 3. Enqueue the job
    await this.queueService.enqueueKnowledgeAnalysis({
      projectId,
      organizationId,
      forceReanalysis: force,
      triggeredBy: 'user',
    });
  }

  /**
   * Returns the current knowledge analysis status for a project.
   * For COMPLETE / PARTIAL states it also fetches live document statuses
   * from the AI_MANIFEST stored on the knowledge branch.
   */
  async getStatus(
    projectId: string,
    organizationId: string,
  ): Promise<KnowledgeStatusDto> {
    // 1. Verify ownership and get the project record
    const project = await this.validateProjectOwnership(projectId, organizationId);

    // 2. Read the KnowledgeAnalysis record from the database
    const record = await this.prisma.knowledgeAnalysis.findUnique({
      where: { projectId },
    });

    // 3. No record yet — return default PENDING state
    if (!record) {
      return {
        analysisStatus: 'PENDING',
        lastAnalyzedCommit: null,
        lastAnalyzedAt: null,
        lastErrorMessage: null,
      };
    }

    const dto: KnowledgeStatusDto = {
      analysisStatus: record.analysisStatus as KnowledgeAnalysisStatus,
      lastAnalyzedCommit: record.lastAnalyzedCommit ?? null,
      lastAnalyzedAt: record.lastAnalyzedAt
        ? record.lastAnalyzedAt.toISOString()
        : null,
      lastErrorMessage: record.lastErrorMessage ?? null,
      alreadyUpToDate: false,
    };

    // 4. For terminal success states, enrich with live document statuses from AI_MANIFEST
    if (
      record.analysisStatus === 'COMPLETE' ||
      record.analysisStatus === 'PARTIAL'
    ) {
      const [owner, repo] = project.githubRepoFullName.split('/');

      try {
        const manifestRaw = await this.githubService.getFileContent(
          organizationId,
          owner,
          repo,
          'AI_MANIFEST.json',
          'ai/architecture',
        );

        if (manifestRaw) {
          const manifest = JSON.parse(manifestRaw) as {
            documents?: Record<
              KnowledgeDocumentName,
              { status: DocumentStatus }
            >;
          };

          if (manifest.documents) {
            dto.documents = manifest.documents as Record<
              KnowledgeDocumentName,
              { status: DocumentStatus }
            >;
          }
        }
      } catch {
        // Best-effort — if manifest is unreadable, omit document statuses
      }
    }

    return dto;
  }

  /**
   * Returns true if a knowledge analysis job is already running for the project,
   * either by DB record status or by an active/waiting BullMQ job.
   */
  private async checkRunning(projectId: string): Promise<boolean> {
    // Check the DB record first
    const record = await this.prisma.knowledgeAnalysis.findUnique({
      where: { projectId },
      select: { analysisStatus: true },
    });

    if (record?.analysisStatus === 'RUNNING') {
      return true;
    }

    // Check BullMQ for waiting or active jobs with the same projectId
    const queue = this.queueService.getKnowledgeQueue();
    const [waitingJobs, activeJobs] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
    ]);

    const allJobs = [...waitingJobs, ...activeJobs];
    return allJobs.some((job) => job.data?.projectId === projectId);
  }

  /**
   * Validates that the project exists and belongs to the given organisation.
   * Throws ForbiddenException if not found.
   * Returns the project record (including githubRepoFullName) on success.
   */
  private async validateProjectOwnership(
    projectId: string,
    organizationId: string,
  ): Promise<{ githubRepoFullName: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { githubRepoFullName: true },
    });

    if (!project) {
      throw new ForbiddenException('Không có quyền truy cập dự án này.');
    }

    return project;
  }
}
