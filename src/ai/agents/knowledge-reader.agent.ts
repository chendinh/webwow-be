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

// Cache entry: tracks whether the knowledge branch/manifest is available
interface ManifestCacheEntry {
  available: boolean;      // false = 404 or failed
  cachedAt: number;        // Date.now()
  content: string | null;  // null when unavailable
}

// TTL for negative cache (404): 5 minutes — avoids hammering GitHub on missing branch
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class KnowledgeReaderAgent {
  private readonly logger = new Logger(KnowledgeReaderAgent.name);

  // Key: `${owner}/${repo}` → cached manifest fetch result
  private readonly manifestCache = new Map<string, ManifestCacheEntry>();

  constructor(
    private readonly githubService: GithubService,
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Lightweight check: returns whether the knowledge branch and AI_MANIFEST.json exist.
   * Uses the same in-memory cache as readKnowledgeDocs — no extra GitHub calls if recently checked.
   */
  async checkAvailability(
    owner: string,
    repo: string,
    organizationId: string,
  ): Promise<{ available: boolean }> {
    const cacheKey = `${owner}/${repo}`;
    const now = Date.now();

    const cached = this.manifestCache.get(cacheKey);
    if (cached && now - cached.cachedAt < MANIFEST_CACHE_TTL_MS) {
      return { available: cached.available };
    }

    // Not cached — do a fresh fetch
    try {
      const manifestRaw = await this.githubService.getFileContent(
        organizationId,
        owner,
        repo,
        AI_MANIFEST_PATH,
        KNOWLEDGE_BRANCH,
      );
      const available = manifestRaw !== null;
      this.manifestCache.set(cacheKey, { available, cachedAt: now, content: manifestRaw });
      return { available };
    } catch {
      this.manifestCache.set(cacheKey, { available: false, cachedAt: now, content: null });
      return { available: false };
    }
  }

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
    const docList = ['OVERVIEW.md', 'PROJECT.md', 'ARCHITECTURE.md', 'MODULES.md', 'FILE_INDEX.md'];
    return this.readKnowledgeDocs(owner, repo, organizationId, projectId, docList);
  }

  async readForAnalysisTask(
    owner: string,
    repo: string,
    organizationId: string,
    projectId: string,
  ): Promise<KnowledgeContext | null> {
    const docList = ['OVERVIEW.md', 'PROJECT.md', 'ARCHITECTURE.md', 'MODULES.md', 'API.md', 'BUSINESS_RULES.md'];
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
    const cacheKey = `${owner}/${repo}`;
    const now = Date.now();

    // 1. Check negative cache — skip GitHub request if we recently got a 404
    const cached = this.manifestCache.get(cacheKey);
    if (cached && now - cached.cachedAt < MANIFEST_CACHE_TTL_MS) {
      if (!cached.available) {
        this.logger.debug(`[manifest-cache] Skipping AI_MANIFEST.json fetch for ${cacheKey} — cached 404 (${Math.round((now - cached.cachedAt) / 1000)}s ago)`);
        return null;
      }
      // Positive cache: manifest is available, use cached content
      if (cached.content !== null) {
        this.logger.debug(`[manifest-cache] Using cached manifest for ${cacheKey}`);
        return this.buildContextFromManifest(cached.content, organizationId, projectId, docList, owner, repo);
      }
    }

    // 2. Fetch AI_MANIFEST.json from the knowledge branch
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
      this.manifestCache.set(cacheKey, { available: false, cachedAt: now, content: null });
      return null;
    }

    // 3. If null / 404 — cache the negative result, log once at debug level (not warn)
    if (manifestRaw === null) {
      this.logger.debug(`AI_MANIFEST.json not found on knowledge branch for ${cacheKey} — caching for ${MANIFEST_CACHE_TTL_MS / 1000}s`);
      this.manifestCache.set(cacheKey, { available: false, cachedAt: now, content: null });
      return null;
    }

    // Positive cache
    this.manifestCache.set(cacheKey, { available: true, cachedAt: now, content: manifestRaw });

    return this.buildContextFromManifest(manifestRaw, organizationId, projectId, docList, owner, repo);
  }

  /**
   * Parses manifest and fetches the relevant knowledge documents.
   */
  private async buildContextFromManifest(
    manifestRaw: string,
    organizationId: string,
    projectId: string,
    docList: string[],
    owner: string,
    repo: string,
  ): Promise<KnowledgeContext | null> {
    // Parse and validate the manifest
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(manifestRaw);
    } catch {
      this.logger.warn('AI_MANIFEST.json is not valid JSON');
      return null;
    }

    if (!validateManifest(parsedRaw)) {
      this.logger.warn('AI_MANIFEST.json failed schema validation');
      return null;
    }

    const manifest = parsedRaw as AIManifest;

    if (manifest.status === 'failed') {
      this.logger.warn('AI_MANIFEST.json status is "failed" — skipping knowledge context');
      return null;
    }

    // Fetch each document, skipping those marked 'not_applicable'
    const documents: Record<string, string> = {};
    const promptParts: string[] = [];

    for (const docName of docList) {
      const docEntry = manifest.documents[docName as keyof typeof manifest.documents];

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
      }

      if (content !== null) {
        documents[docName] = content;
        promptParts.push(`### ${docName}\n\n${content}`);
      }
    }

    const promptSection =
      `## Project Architecture Knowledge (${KNOWLEDGE_BRANCH})\n\n` +
      promptParts.join('\n\n');

    return {
      manifestStatus: manifest.status,
      documents,
      promptSection,
    };
  }
}
