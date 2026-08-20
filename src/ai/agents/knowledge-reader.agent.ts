import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from '../../modules/github/github.service';
import { ActivityService } from '../../modules/activity/activity.service';
import {
  KNOWLEDGE_BRANCH,
  AI_MANIFEST_PATH,
  AIManifest,
  validateManifest,
} from '../../modules/knowledge/types/knowledge.types';

export interface KnowledgeContext {
  manifestStatus: 'complete' | 'partial' | 'failed';
  documents: Record<string, string>; // filename → content
  promptSection: string; // Pre-formatted section for Claude prompt
}

@Injectable()
export class KnowledgeReaderAgent {
  private readonly logger = new Logger(KnowledgeReaderAgent.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Reads Knowledge Branch documents relevant for a coding task.
   * Documents: PROJECT.md, ARCHITECTURE.md, MODULES.md, FILE_INDEX.md
   */
  async readForCodingTask(
    owner: string,
    repo: string,
    organizationId: string,
    projectId: string,
  ): Promise<KnowledgeContext | null> {
    const docList = ['PROJECT.md', 'ARCHITECTURE.md', 'MODULES.md', 'FILE_INDEX.md'];
    return this.readKnowledgeDocs(owner, repo, organizationId, projectId, docList);
  }

  /**
   * Reads Knowledge Branch documents relevant for an analysis task.
   * Documents: PROJECT.md, ARCHITECTURE.md, MODULES.md, API.md, BUSINESS_RULES.md
   */
  async readForAnalysisTask(
    owner: string,
    repo: string,
    organizationId: string,
    projectId: string,
  ): Promise<KnowledgeContext | null> {
    const docList = ['PROJECT.md', 'ARCHITECTURE.md', 'MODULES.md', 'API.md', 'BUSINESS_RULES.md'];
    return this.readKnowledgeDocs(owner, repo, organizationId, projectId, docList);
  }

  /**
   * Core implementation: fetches AI_MANIFEST.json, validates it, then fetches
   * each applicable document and assembles a KnowledgeContext.
   */
  private async readKnowledgeDocs(
    owner: string,
    repo: string,
    organizationId: string,
    projectId: string,
    docList: string[],
  ): Promise<KnowledgeContext | null> {
    // 1. Fetch AI_MANIFEST.json from the knowledge branch
    let manifestRaw: string | null;
    try {
      manifestRaw = await this.githubService.getFileContent(
        organizationId,
        owner,
        repo,
        AI_MANIFEST_PATH,
        KNOWLEDGE_BRANCH,
      );
    } catch (err) {
      this.logger.warn(`Failed to fetch AI_MANIFEST.json: ${String(err)}`);
      await this.logWarn(organizationId, projectId);
      return null;
    }

    // 2. If null / 404 — log warn and return null
    if (manifestRaw === null) {
      this.logger.warn('AI_MANIFEST.json not found on knowledge branch');
      await this.logWarn(organizationId, projectId);
      return null;
    }

    // 3. Parse and validate the manifest
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(manifestRaw);
    } catch {
      this.logger.warn('AI_MANIFEST.json is not valid JSON');
      await this.logWarn(organizationId, projectId);
      return null;
    }

    if (!validateManifest(parsedRaw)) {
      this.logger.warn('AI_MANIFEST.json failed schema validation');
      await this.logWarn(organizationId, projectId);
      return null;
    }

    const manifest = parsedRaw as AIManifest;

    // 4. If manifest.status is 'failed' — log warn and return null
    if (manifest.status === 'failed') {
      this.logger.warn('AI_MANIFEST.json status is "failed" — skipping knowledge context');
      await this.logWarn(organizationId, projectId);
      return null;
    }

    // 5. Fetch each document, skipping those marked 'not_applicable'
    const documents: Record<string, string> = {};
    const promptParts: string[] = [];

    for (const docName of docList) {
      const docEntry = manifest.documents[docName as keyof typeof manifest.documents];

      // Skip docs explicitly marked as not_applicable
      if (docEntry?.status === 'not_applicable') {
        this.logger.debug(`Skipping ${docName} — marked not_applicable in manifest`);
        continue;
      }

      let content: string | null = null;
      try {
        content = await this.githubService.getFileContent(
          organizationId,
          owner,
          repo,
          docName,
          KNOWLEDGE_BRANCH,
        );
      } catch (err) {
        this.logger.warn(`Failed to fetch ${docName}: ${String(err)}`);
        // Continue with other docs — partial context is better than none
      }

      if (content !== null) {
        documents[docName] = content;
        promptParts.push(`### ${docName}\n\n${content}`);
      }
    }

    // 6. Build the prompt section
    const promptSection =
      `## Project Architecture Knowledge (${KNOWLEDGE_BRANCH})\n\n` +
      promptParts.join('\n\n');

    return {
      manifestStatus: manifest.status,
      documents,
      promptSection,
    };
  }

  /**
   * Logs a warning ActivityLog entry when the knowledge branch is unavailable.
   */
  private async logWarn(organizationId: string, projectId: string): Promise<void> {
    try {
      await this.activityService.log({
        organizationId,
        projectId,
        eventType: 'ERROR',
        agentType: 'KnowledgeReaderAgent',
        friendlyMessage:
          'Knowledge branch unavailable or incomplete — proceeding without architecture context',
        actorId: 'system',
      });
    } catch (logErr) {
      // Never let logging failures block the main flow
      this.logger.warn(`Failed to write ActivityLog: ${String(logErr)}`);
    }
  }
}
