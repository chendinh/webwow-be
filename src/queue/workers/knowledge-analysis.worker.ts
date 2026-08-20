import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { GithubService } from '../../modules/github/github.service';
import { QueueService } from '../queue.service';
import { ActivityService } from '../../modules/activity/activity.service';
import { AI_PROVIDER, IAIProvider } from '../../ai/providers/ai-provider.interface';
import { KnowledgePrompt, RepoAnalysisData } from '../../ai/prompts/knowledge.prompt';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { KnowledgeAnalysisJobData } from '../queue.types';
import {
  KNOWLEDGE_BRANCH,
  AI_MANIFEST_PATH,
  KNOWLEDGE_DOCUMENTS,
  KnowledgeDocumentName,
  AIManifest,
  DocumentStatus,
  ManifestStatus,
  mapChangesToDocuments,
  maskSecrets,
  filterSafeFiles,
  buildVietnameseError,
} from '../../modules/knowledge/types/knowledge.types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocResult {
  name: KnowledgeDocumentName;
  content: string | null;
  status: DocumentStatus;
  tokensUsed: number;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Processor(QUEUES.KNOWLEDGE_ANALYSIS, { concurrency: CONCURRENCY.KNOWLEDGE_ANALYSIS })
export class KnowledgeAnalysisWorker extends WorkerHost {
  private readonly logger = new Logger(KnowledgeAnalysisWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    private readonly queueService: QueueService,
    private readonly activityService: ActivityService,
    @Inject(AI_PROVIDER) private readonly aiProvider: IAIProvider,
  ) {
    super();
  }

  // ── Entry point ─────────────────────────────────────────────────────────────

  async process(job: Job<KnowledgeAnalysisJobData>): Promise<void> {
    const { projectId, organizationId, forceReanalysis } = job.data;

    this.logger.log(
      `KnowledgeAnalysis starting — project=${projectId} force=${forceReanalysis}`,
    );

    // ── Step 1: Upsert record → RUNNING ─────────────────────────────────────
    await this.prisma.knowledgeAnalysis.upsert({
      where: { projectId },
      create: { projectId, organizationId, analysisStatus: 'RUNNING' },
      update: { analysisStatus: 'RUNNING', lastErrorMessage: null },
    });

    try {
      // ── Step 2: Fetch project to get owner/repo ────────────────────────────
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          githubRepoFullName: true,
          defaultBranch: true,
          analysis: {
            select: {
              databases: true,
              primaryLanguage: true,
              frameworks: true,
              buildTools: true,
              packageManager: true,
            },
          },
        },
      });

      const [owner, repo] = project.githubRepoFullName.split('/');
      const sourceBranch = project.defaultBranch ?? 'main';

      // ── Step 3: Routing logic ──────────────────────────────────────────────

      // 3a. Does the knowledge branch exist?
      const branchHeadSha = await this.githubService.getBranchHeadSha(
        organizationId,
        owner,
        repo,
        KNOWLEDGE_BRANCH,
      );

      if (branchHeadSha === null) {
        this.logger.log(`Branch '${KNOWLEDGE_BRANCH}' not found — running Initial Analysis`);
        await this.runInitialAnalysis(
          projectId,
          organizationId,
          owner,
          repo,
          sourceBranch,
          project,
        );
        return;
      }

      // 3b. forceReanalysis overrides everything
      if (forceReanalysis) {
        this.logger.log(`forceReanalysis=true — running Force Analysis`);
        await this.runForceAnalysis(
          projectId,
          organizationId,
          owner,
          repo,
          sourceBranch,
          project,
        );
        return;
      }

      // 3c. Read AI_MANIFEST
      const manifestRaw = await this.githubService.getFileContent(
        organizationId,
        owner,
        repo,
        AI_MANIFEST_PATH,
        KNOWLEDGE_BRANCH,
      );

      let manifest: AIManifest | null = null;
      if (manifestRaw) {
        try {
          manifest = JSON.parse(manifestRaw) as AIManifest;
        } catch {
          this.logger.warn('AI_MANIFEST.json is unparseable — falling back to Initial Analysis');
        }
      }

      if (!manifest) {
        this.logger.log('AI_MANIFEST missing or unparseable — running Initial Analysis');
        await this.runInitialAnalysis(
          projectId,
          organizationId,
          owner,
          repo,
          sourceBranch,
          project,
        );
        return;
      }

      // 3d. Get current HEAD of source branch
      const currentHeadSha = await this.githubService.getBranchHeadSha(
        organizationId,
        owner,
        repo,
        sourceBranch,
      );

      if (!currentHeadSha) {
        throw new Error(`Could not read HEAD SHA for branch '${sourceBranch}'`);
      }

      // 3e. No-op guard — already up-to-date
      const allComplete = KNOWLEDGE_DOCUMENTS.every(
        (doc) =>
          manifest!.documents[doc]?.status === 'complete' ||
          manifest!.documents[doc]?.status === 'not_applicable',
      );

      if (manifest.sourceCommit === currentHeadSha && allComplete) {
        this.logger.log('Knowledge branch is up-to-date — no-op');
        await this.prisma.knowledgeAnalysis.update({
          where: { projectId },
          data: {
            analysisStatus: 'COMPLETE',
            lastAnalyzedCommit: currentHeadSha,
            lastAnalyzedAt: new Date(),
            lastErrorMessage: null,
          },
        });
        return;
      }

      // 3f. Incremental update
      this.logger.log(`sourceCommit differs or docs incomplete — running Incremental Update`);
      await this.runIncrementalUpdate(
        projectId,
        organizationId,
        owner,
        repo,
        sourceBranch,
        currentHeadSha,
        manifest,
        project,
      );
    } catch (err: unknown) {
      this.logger.error(
        `KnowledgeAnalysis FAILED for project=${projectId}`,
        err instanceof Error ? err.stack : String(err),
      );

      const errorMessage = buildVietnameseError(err);
      await this.prisma.knowledgeAnalysis
        .update({
          where: { projectId },
          data: { analysisStatus: 'FAILED', lastErrorMessage: errorMessage },
        })
        .catch((dbErr: unknown) =>
          this.logger.error('Failed to persist FAILED status', String(dbErr)),
        );

      // Re-throw for BullMQ retry
      throw err;
    }
  }

  // ── Initial Analysis ────────────────────────────────────────────────────────

  private async runInitialAnalysis(
    projectId: string,
    organizationId: string,
    owner: string,
    repo: string,
    sourceBranch: string,
    project: ProjectRecord,
  ): Promise<void> {
    // Create orphan branch
    await this.githubService.createOrphanBranch(organizationId, owner, repo, KNOWLEDGE_BRANCH);

    // Get current HEAD SHA
    const headSha = await this.githubService.getBranchHeadSha(
      organizationId,
      owner,
      repo,
      sourceBranch,
    );
    if (!headSha) {
      throw new Error(`Could not read HEAD SHA for branch '${sourceBranch}'`);
    }

    // Collect repo data
    const repoData = await this.collectRepoData(organizationId, owner, repo, sourceBranch, project);

    // Generate all applicable documents
    const docResults = await this.generateAllDocuments(
      projectId,
      organizationId,
      repoData,
      project,
    );

    // Commit everything
    await this.commitDocResults(
      organizationId,
      owner,
      repo,
      docResults,
      headSha,
      sourceBranch,
      'ai: initialize architecture knowledge',
    );

    // Finalize record
    await this.finalizeRecord(projectId, docResults, headSha);
  }

  // ── Force Analysis ──────────────────────────────────────────────────────────

  private async runForceAnalysis(
    projectId: string,
    organizationId: string,
    owner: string,
    repo: string,
    sourceBranch: string,
    project: ProjectRecord,
  ): Promise<void> {
    // Delete all existing docs from the knowledge branch
    const existingDocs = KNOWLEDGE_DOCUMENTS.map((d) => d);
    const existingDocPaths = [...existingDocs, AI_MANIFEST_PATH];

    await this.githubService
      .deleteFiles(
        organizationId,
        owner,
        repo,
        KNOWLEDGE_BRANCH,
        existingDocPaths,
        'ai: clear knowledge branch for force re-analysis',
      )
      .catch((err) =>
        // If files don't exist to delete, that's fine — continue
        this.logger.warn(`deleteFiles during force analysis: ${String(err)}`),
      );

    // Get current HEAD SHA
    const headSha = await this.githubService.getBranchHeadSha(
      organizationId,
      owner,
      repo,
      sourceBranch,
    );
    if (!headSha) {
      throw new Error(`Could not read HEAD SHA for branch '${sourceBranch}'`);
    }

    // Collect repo data and regenerate all docs
    const repoData = await this.collectRepoData(organizationId, owner, repo, sourceBranch, project);
    const docResults = await this.generateAllDocuments(
      projectId,
      organizationId,
      repoData,
      project,
    );

    // Commit everything
    await this.commitDocResults(
      organizationId,
      owner,
      repo,
      docResults,
      headSha,
      sourceBranch,
      'ai: force re-analyze architecture knowledge',
    );

    // Finalize record
    await this.finalizeRecord(projectId, docResults, headSha);
  }

  // ── Incremental Update ──────────────────────────────────────────────────────

  private async runIncrementalUpdate(
    projectId: string,
    organizationId: string,
    owner: string,
    repo: string,
    sourceBranch: string,
    currentHeadSha: string,
    manifest: AIManifest,
    project: ProjectRecord,
  ): Promise<void> {
    // Get list of changed files since the last analyzed commit
    const changedPaths = await this.githubService.getCommitDiff(
      organizationId,
      owner,
      repo,
      manifest.sourceCommit,
      currentHeadSha,
    );

    this.logger.log(
      `Incremental: ${changedPaths.length} changed files since ${manifest.sourceCommit.slice(0, 7)}`,
    );

    // Determine which documents need regenerating
    const docsToUpdate = mapChangesToDocuments(changedPaths);

    // Also include any docs that previously failed
    for (const doc of KNOWLEDGE_DOCUMENTS) {
      if (manifest.documents[doc]?.status === 'failed') {
        docsToUpdate.add(doc);
      }
    }

    if (docsToUpdate.size === 0) {
      // No mapping matches — just update sourceCommit in manifest
      this.logger.log('No document mappings matched — updating manifest sourceCommit only');
      const updatedManifest: AIManifest = {
        ...manifest,
        sourceCommit: currentHeadSha,
        analyzedAt: new Date().toISOString(),
      };
      await this.githubService.commitFiles(
        organizationId,
        owner,
        repo,
        KNOWLEDGE_BRANCH,
        [{ path: AI_MANIFEST_PATH, content: JSON.stringify(updatedManifest, null, 2) }],
        'ai: update knowledge manifest sourceCommit',
      );
      await this.prisma.knowledgeAnalysis.update({
        where: { projectId },
        data: {
          analysisStatus: 'COMPLETE',
          lastAnalyzedCommit: currentHeadSha,
          lastAnalyzedAt: new Date(),
          lastErrorMessage: null,
        },
      });
      return;
    }

    this.logger.log(
      `Incremental: regenerating ${[...docsToUpdate].join(', ')}`,
    );

    // Collect repo data
    const repoData = await this.collectRepoData(organizationId, owner, repo, sourceBranch, project);

    // Generate only affected documents
    const docResults: DocResult[] = [];
    for (const docName of docsToUpdate) {
      const result = await this.generateSingleDocument(
        projectId,
        organizationId,
        docName,
        repoData,
        project,
      );
      docResults.push(result);
    }

    // Merge with existing manifest document statuses
    const mergedDocStatuses = { ...manifest.documents };
    for (const result of docResults) {
      mergedDocStatuses[result.name] = {
        status: result.status,
        lastUpdatedCommit: currentHeadSha,
      };
    }

    // Build updated manifest
    const allSucceeded = docResults.every((r) => r.status === 'complete');
    const anyFailed = docResults.some((r) => r.status === 'failed');
    const overallManifestStatus: ManifestStatus = anyFailed ? 'partial' : 'complete';

    const updatedManifest: AIManifest = {
      ...manifest,
      status: overallManifestStatus,
      sourceCommit: currentHeadSha,
      analyzedAt: new Date().toISOString(),
      documents: mergedDocStatuses as AIManifest['documents'],
    };

    // Build commit files: successful docs + updated manifest
    const filesToCommit: Array<{ path: string; content: string }> = docResults
      .filter((r) => r.status === 'complete' && r.content !== null)
      .map((r) => ({ path: r.name as string, content: r.content as string }));
    filesToCommit.push({ path: AI_MANIFEST_PATH, content: JSON.stringify(updatedManifest, null, 2) });

    await this.githubService.commitFiles(
      organizationId,
      owner,
      repo,
      KNOWLEDGE_BRANCH,
      filesToCommit,
      'ai: update architecture knowledge (incremental)',
    );

    // Update DB record
    const finalStatus = anyFailed ? 'PARTIAL' : 'COMPLETE';
    await this.prisma.knowledgeAnalysis.update({
      where: { projectId },
      data: {
        analysisStatus: finalStatus,
        lastAnalyzedCommit: currentHeadSha,
        lastAnalyzedAt: new Date(),
        lastErrorMessage: null,
      },
    });

    this.logger.log(
      `Incremental Update ${finalStatus} for project=${projectId}, ${allSucceeded ? 'all docs ok' : 'some docs failed'}`,
    );
  }

  // ── Document generation helpers ─────────────────────────────────────────────

  /**
   * Generate all applicable Knowledge Documents.
   */
  private async generateAllDocuments(
    projectId: string,
    organizationId: string,
    repoData: RepoAnalysisData,
    project: ProjectRecord,
  ): Promise<DocResult[]> {
    const results: DocResult[] = [];

    for (const docName of KNOWLEDGE_DOCUMENTS) {
      const result = await this.generateSingleDocument(
        projectId,
        organizationId,
        docName,
        repoData,
        project,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Generate a single Knowledge Document by calling Claude via AI_PROVIDER.
   * Returns a DocResult with status 'complete', 'not_applicable', or 'failed'.
   */
  private async generateSingleDocument(
    projectId: string,
    organizationId: string,
    docName: KnowledgeDocumentName,
    repoData: RepoAnalysisData,
    project: ProjectRecord,
  ): Promise<DocResult> {
    // Check applicability for certain documents
    if (docName === 'DATABASE.md') {
      const hasDatabases =
        project.analysis?.databases && project.analysis.databases.length > 0;
      if (!hasDatabases) {
        return { name: docName, content: null, status: 'not_applicable', tokensUsed: 0 };
      }
    }

    if (docName === 'API.md') {
      const hasControllers = repoData.fileTree.some((f) =>
        f.toLowerCase().includes('controller'),
      );
      if (!hasControllers) {
        return { name: docName, content: null, status: 'not_applicable', tokensUsed: 0 };
      }
    }

    try {
      const { system, user } = this.buildPromptForDoc(docName, repoData);
      const startMs = Date.now();

      const response = await this.aiProvider.call<string>(system, user, {
        maxTokens: 4096,
        temperature: 0.1,
      });

      const durationMs = Date.now() - startMs;
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Enforce 500-line limit
      const truncated = this.enforceLineLimit(content, 500);

      // Log AI call to ActivityLog (non-blocking)
      this.activityService
        .log({
          organizationId,
          projectId,
          eventType: 'AI_CALL',
          agentType: 'KnowledgeAnalyzer',
          aiModel: response.model,
          tokensUsed: response.inputTokens + response.outputTokens,
          estimatedCost: response.estimatedCostUsd,
          durationMs,
          friendlyMessage: `Tạo tài liệu ${docName} hoàn tất. Token: ${response.inputTokens + response.outputTokens}.`,
          technicalDetail: { documentType: docName, inputTokens: response.inputTokens, outputTokens: response.outputTokens },
          actorId: 'system',
        })
        .catch((err) =>
          this.logger.warn(`ActivityLog write failed for ${docName}: ${String(err)}`),
        );

      this.logger.log(
        `Generated ${docName}: ${response.inputTokens + response.outputTokens} tokens, ${durationMs}ms`,
      );

      return {
        name: docName,
        content: truncated,
        status: 'complete',
        tokensUsed: response.inputTokens + response.outputTokens,
      };
    } catch (err: unknown) {
      this.logger.error(
        `Failed to generate ${docName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { name: docName, content: null, status: 'failed', tokensUsed: 0 };
    }
  }

  /**
   * Build the prompt pair for a given document type.
   */
  private buildPromptForDoc(
    docName: KnowledgeDocumentName,
    repoData: RepoAnalysisData,
  ): { system: string; user: string } {
    switch (docName) {
      case 'PROJECT.md':
        return KnowledgePrompt.buildProjectMd(repoData);

      case 'ARCHITECTURE.md':
        return KnowledgePrompt.buildArchitectureMd(repoData, repoData.fileTree);

      case 'MODULES.md': {
        const moduleFiles = repoData.fileTree.filter(
          (f) =>
            f.endsWith('.module.ts') ||
            f.includes('/module/') ||
            (f.startsWith('src/') && f.endsWith('/index.ts')),
        );
        return KnowledgePrompt.buildModulesMd(repoData, moduleFiles);
      }

      case 'API.md': {
        const controllerFiles = repoData.fileTree.filter((f) =>
          f.toLowerCase().includes('controller'),
        );
        return KnowledgePrompt.buildApiMd(repoData, controllerFiles, []);
      }

      case 'DATABASE.md':
        // schemaContent is not pre-fetched here (it's fetched in collectRepoData)
        return KnowledgePrompt.buildDatabaseMd(repoData, null);

      case 'DEPENDENCIES.md':
        return KnowledgePrompt.buildDependenciesMd(repoData);

      case 'CONVENTIONS.md':
        return KnowledgePrompt.buildConventionsMd(repoData, null, null);

      case 'BUSINESS_RULES.md': {
        const domainFiles = repoData.fileTree
          .filter(
            (f) =>
              f.includes('.service.ts') ||
              f.includes('.guard.ts') ||
              f.includes('/domain/') ||
              f.includes('/entities/'),
          )
          .slice(0, 8)
          .map((f) => ({ path: f, content: '' }));
        return KnowledgePrompt.buildBusinessRulesMd(repoData, domainFiles);
      }

      case 'FILE_INDEX.md':
        return KnowledgePrompt.buildFileIndexMd(repoData, repoData.fileTree);

      default:
        return KnowledgePrompt.buildProjectMd(repoData);
    }
  }

  // ── Repo data collection ─────────────────────────────────────────────────────

  /**
   * Collect all relevant repository data for prompt building.
   * Applies maskSecrets() and filterSafeFiles() to all content before returning.
   */
  private async collectRepoData(
    organizationId: string,
    owner: string,
    repo: string,
    sourceBranch: string,
    project: ProjectRecord,
  ): Promise<RepoAnalysisData> {
    // Fetch key files in parallel
    const [packageJsonRaw, tsconfigRaw, readmeRaw] = await Promise.all([
      this.githubService.getFileContent(organizationId, owner, repo, 'package.json', sourceBranch),
      this.githubService.getFileContent(organizationId, owner, repo, 'tsconfig.json', sourceBranch),
      this.githubService.getFileContent(organizationId, owner, repo, 'README.md', sourceBranch),
    ]);

    let packageJson: Record<string, unknown> | null = null;
    if (packageJsonRaw) {
      try {
        packageJson = JSON.parse(maskSecrets(packageJsonRaw)) as Record<string, unknown>;
      } catch {
        this.logger.warn(`Failed to parse package.json for ${owner}/${repo}`);
      }
    }

    // Crawl file tree (up to 3 levels)
    const rawFileTree = await this.crawlFileTree(organizationId, owner, repo, sourceBranch);

    // Apply filterSafeFiles to exclude secrets
    const fileTree = filterSafeFiles(rawFileTree);

    const analysis = project.analysis;

    return {
      projectName: repo,
      defaultBranch: sourceBranch,
      primaryLanguage: analysis?.primaryLanguage ?? 'typescript',
      frameworks: analysis?.frameworks ?? [],
      databases: analysis?.databases ?? [],
      buildTools: analysis?.buildTools ?? [],
      packageManager: analysis?.packageManager ?? 'npm',
      packageJson,
      tsconfig: tsconfigRaw ? maskSecrets(tsconfigRaw) : null,
      readmeSnippet: readmeRaw ? maskSecrets(readmeRaw).slice(0, 800) : null,
      fileTree,
      hasDockerfile: false, // we don't fetch Dockerfile for knowledge gen
      hasCiWorkflow: false,
    };
  }

  /**
   * Crawl the repository file tree up to 3 levels deep.
   * Excludes common build/artifact directories.
   */
  private async crawlFileTree(
    organizationId: string,
    owner: string,
    repo: string,
    ref: string,
    path = '',
    depth = 0,
    result: string[] = [],
  ): Promise<string[]> {
    if (depth > 2) return result;

    const EXCLUDED_DIRS = new Set([
      'node_modules', 'dist', 'build', 'coverage', '.next', '.git',
      '__pycache__', '.cache', 'example-ui', '.turbo',
    ]);

    try {
      // Use getFileContent with a path that lists a directory doesn't work —
      // we need to get directory listing. We do this by calling the GitHub API
      // via the raw octokit. Instead, we re-use getFileContent's underlying logic
      // by listing the GitHub contents API directory.
      // Since GithubService doesn't expose a listDirectory method, we approximate
      // by calling getFileContent on common known paths plus scanning fileTree
      // from the project analysis. Fall back gracefully on error.
      //
      // To avoid a large surface area, we do a best-effort crawl using
      // project.analysis.directoryStructure if available, otherwise we make
      // a call to get root contents via the available getFileContent approach.
      //
      // NOTE: For the actual tree crawl we rely on the GitHub API via
      // getDecryptedToken + dynamic Octokit import (same as in ProjectAnalysisWorker).
      const token = await (this.githubService as unknown as {
        getDecryptedToken(orgId: string): Promise<string>;
      }).getDecryptedToken(organizationId);

      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: token });

      const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        { owner, repo, path, ref },
      );

      if (!Array.isArray(data)) return result;

      for (const entry of data) {
        if (entry.name.startsWith('.') && depth > 0) continue;
        if (EXCLUDED_DIRS.has(entry.name)) continue;

        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.type === 'dir') {
          result.push(`${entryPath}/`);
          await this.crawlFileTree(organizationId, owner, repo, ref, entryPath, depth + 1, result);
        } else {
          result.push(entryPath);
        }
      }
    } catch (err) {
      this.logger.warn(`File tree crawl error at path='${path}': ${String(err)}`);
    }

    return result;
  }

  // ── Commit helpers ───────────────────────────────────────────────────────────

  /**
   * Commit all successful doc results + AI_MANIFEST to the knowledge branch.
   */
  private async commitDocResults(
    organizationId: string,
    owner: string,
    repo: string,
    docResults: DocResult[],
    headSha: string,
    sourceBranch: string,
    commitMessage: string,
  ): Promise<void> {
    const anyFailed = docResults.some((r) => r.status === 'failed');
    const manifestStatus: ManifestStatus = anyFailed ? 'partial' : 'complete';

    const manifestDocuments: AIManifest['documents'] = {} as AIManifest['documents'];
    for (const doc of KNOWLEDGE_DOCUMENTS) {
      const result = docResults.find((r) => r.name === doc);
      manifestDocuments[doc] = {
        status: result?.status ?? 'not_applicable',
        lastUpdatedCommit: headSha,
      };
    }

    const manifest: AIManifest = {
      schemaVersion: 1,
      status: manifestStatus,
      knowledgeBranch: KNOWLEDGE_BRANCH,
      sourceBranch,
      sourceCommit: headSha,
      analyzedAt: new Date().toISOString(),
      documents: manifestDocuments,
    };

    const filesToCommit: Array<{ path: string; content: string }> = docResults
      .filter((r) => r.status === 'complete' && r.content !== null)
      .map((r) => ({ path: r.name as string, content: r.content as string }));

    filesToCommit.push({
      path: AI_MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2),
    });

    await this.githubService.commitFiles(
      organizationId,
      owner,
      repo,
      KNOWLEDGE_BRANCH,
      filesToCommit,
      commitMessage,
    );
  }

  /**
   * Update the KnowledgeAnalysis DB record after a full analysis run.
   */
  private async finalizeRecord(
    projectId: string,
    docResults: DocResult[],
    headSha: string,
  ): Promise<void> {
    const anyFailed = docResults.some((r) => r.status === 'failed');
    const finalStatus = anyFailed ? 'PARTIAL' : 'COMPLETE';

    await this.prisma.knowledgeAnalysis.update({
      where: { projectId },
      data: {
        analysisStatus: finalStatus,
        lastAnalyzedCommit: headSha,
        lastAnalyzedAt: new Date(),
        lastErrorMessage: null,
      },
    });

    const succeeded = docResults.filter((r) => r.status === 'complete').length;
    const failed = docResults.filter((r) => r.status === 'failed').length;
    const notApplicable = docResults.filter((r) => r.status === 'not_applicable').length;

    this.logger.log(
      `KnowledgeAnalysis ${finalStatus} for project=${projectId}: ` +
      `${succeeded} complete, ${failed} failed, ${notApplicable} not_applicable`,
    );
  }

  // ── Utility helpers ──────────────────────────────────────────────────────────

  /**
   * Truncate document content to maxLines lines.
   * Appends the required truncation comment if truncation occurs.
   */
  private enforceLineLimit(content: string, maxLines: number): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return [
      ...lines.slice(0, maxLines),
      '<!-- truncated: content exceeded 500 lines -->',
    ].join('\n');
  }
}

// ─── ProjectRecord type ───────────────────────────────────────────────────────

type ProjectRecord = {
  githubRepoFullName: string;
  defaultBranch: string;
  analysis: {
    databases: string[];
    primaryLanguage: string | null;
    frameworks: string[];
    buildTools: string[];
    packageManager: string | null;
  } | null;
};
