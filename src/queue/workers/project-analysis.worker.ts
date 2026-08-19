import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Octokit } from '@octokit/rest';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GithubService } from '../../modules/github/github.service';
import {
  CompatibilityScorerService,
  AnalysisInput,
} from '../../modules/projects/compatibility-scorer.service';
import { CONCURRENCY, QUEUES } from '../queue.constants';
import { ProjectAnalysisJobData } from '../queue.types';

// ─── Secret masking patterns ──────────────────────────────────────────────────

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,              // OpenAI API keys
  /ghp_[a-zA-Z0-9]{36}/g,              // GitHub Personal Access Tokens
  /[a-zA-Z0-9/+]{40,}={0,2}/g,        // High-entropy base64-ish strings ≥ 40 chars
];

function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(new RegExp(pattern.source, pattern.flags), '[MASKED]');
  }
  return masked;
}

function maskJsonSecrets(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return maskSecrets(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(maskJsonSecrets);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = maskJsonSecrets(value);
    }
    return result;
  }
  return obj;
}

// ─── Safe file fetcher ────────────────────────────────────────────────────────

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
    // data can be array (directory) or file object
    if (Array.isArray(data) || data.type !== 'file') {
      return null;
    }
    if ('content' in data && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch (err: unknown) {
    // 404 means file doesn't exist — silently ignore
    if (
      err !== null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Processor(QUEUES.PROJECT_ANALYSIS, { concurrency: CONCURRENCY.PROJECT_ANALYSIS })
export class ProjectAnalysisWorker extends WorkerHost {
  private readonly logger = new Logger(ProjectAnalysisWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    private readonly compatibilityScorer: CompatibilityScorerService,
  ) {
    super();
  }

  async process(job: Job<ProjectAnalysisJobData>): Promise<void> {
    const { projectId, organizationId, repoFullName } = job.data;
    const [owner, repo] = repoFullName.split('/');

    this.logger.log(`Starting analysis for project ${projectId} (${repoFullName})`);

    try {
      // ── Step 1: Update Project status → ANALYZING ───────────────────────
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'ANALYZING' },
      });

      // ── Step 2: Fetch key config files via GitHub API ────────────────────
      const token = await this.githubService.getDecryptedToken(organizationId);
      const octokit = new Octokit({ auth: token });

      const [
        packageJsonRaw,
        tsconfigRaw,
        readmeRaw,
        dockerfileRaw,
      ] = await Promise.all([
        fetchFileContent(octokit, owner, repo, 'package.json'),
        fetchFileContent(octokit, owner, repo, 'tsconfig.json'),
        fetchFileContent(octokit, owner, repo, 'README.md'),
        fetchFileContent(octokit, owner, repo, 'Dockerfile'),
      ]);

      // Try to fetch a CI workflow file (list .github/workflows dir)
      let ciWorkflowRaw: string | null = null;
      try {
        const { data: workflowsDir } = await octokit.request(
          'GET /repos/{owner}/{repo}/contents/{path}',
          { owner, repo, path: '.github/workflows' },
        );
        if (Array.isArray(workflowsDir) && workflowsDir.length > 0) {
          const firstYml = workflowsDir.find(
            (f) => f.type === 'file' && (f.name.endsWith('.yml') || f.name.endsWith('.yaml')),
          );
          if (firstYml) {
            ciWorkflowRaw = await fetchFileContent(octokit, owner, repo, firstYml.path);
          }
        }
      } catch {
        // .github/workflows doesn't exist — ignore
      }

      // ── Step 3: Detect tech stack ─────────────────────────────────────────
      let packageJson: Record<string, unknown> | null = null;
      if (packageJsonRaw) {
        try {
          packageJson = JSON.parse(packageJsonRaw) as Record<string, unknown>;
        } catch {
          this.logger.warn(`Failed to parse package.json for project ${projectId}`);
        }
      }

      const allDeps: Record<string, string> = {
        ...(typeof packageJson?.dependencies === 'object' && packageJson.dependencies !== null
          ? (packageJson.dependencies as Record<string, string>)
          : {}),
        ...(typeof packageJson?.devDependencies === 'object' && packageJson.devDependencies !== null
          ? (packageJson.devDependencies as Record<string, string>)
          : {}),
      };

      // primaryLanguage
      const hasTsconfig = tsconfigRaw !== null;
      const hasTypescriptDep = 'typescript' in allDeps;
      const primaryLanguage: string =
        hasTsconfig || hasTypescriptDep ? 'typescript' : 'javascript';

      // frameworks
      const frameworkMap: Record<string, string> = {
        react: 'react',
        next: 'next.js',
        '@nestjs/core': 'nestjs',
        express: 'express',
        '@angular/core': 'angular',
        vue: 'vue',
        nuxt: 'nuxt',
        fastify: 'fastify',
        koa: 'koa',
      };
      const frameworks: string[] = Object.entries(frameworkMap)
        .filter(([dep]) => dep in allDeps)
        .map(([, name]) => name);

      // databases
      const dbMap: Record<string, string> = {
        pg: 'postgresql',
        mysql2: 'mysql',
        mongodb: 'mongodb',
        mongoose: 'mongodb',
        redis: 'redis',
        ioredis: 'redis',
        prisma: 'prisma',
        '@prisma/client': 'prisma',
        sequelize: 'sequelize',
        typeorm: 'typeorm',
      };
      const databases: string[] = [
        ...new Set(
          Object.entries(dbMap)
            .filter(([dep]) => dep in allDeps)
            .map(([, name]) => name),
        ),
      ];

      // buildTools
      const buildToolMap: Record<string, string> = {
        webpack: 'webpack',
        vite: 'vite',
        rollup: 'rollup',
        esbuild: 'esbuild',
        tsc: 'tsc',
        '@nestjs/cli': 'nest',
        turbo: 'turbo',
      };
      const buildTools: string[] = Object.entries(buildToolMap)
        .filter(([dep]) => dep in allDeps)
        .map(([, name]) => name);

      // packageManager — from lock file presence (not directly detectable
      // without listing root, so we default to npm and check scripts hints)
      // For MVP: default to npm (lock file checks need listing root dir)
      const packageManager = 'npm';

      // buildScripts
      const rawScripts =
        typeof packageJson?.scripts === 'object' && packageJson.scripts !== null
          ? (packageJson.scripts as Record<string, string>)
          : {};
      const buildScripts: Record<string, string> = {};
      for (const key of ['test', 'build', 'lint', 'format', 'start']) {
        if (key in rawScripts) {
          buildScripts[key] = rawScripts[key];
        }
      }

      // mainDependencies — top 20 deps with version
      const mainDependencies = Object.entries(allDeps)
        .slice(0, 20)
        .map(([name, version]) => ({ name, version: String(version), purpose: '' }));

      // ── Step 4: Detect secrets & mask ────────────────────────────────────
      const safePackageJson = packageJson
        ? (maskJsonSecrets(packageJson) as Record<string, unknown>)
        : null;
      const safeReadme = readmeRaw ? maskSecrets(readmeRaw) : null;

      // ── Step 5: Build directory structure summary ─────────────────────────
      const projectName =
        typeof safePackageJson?.name === 'string' ? safePackageJson.name : repo;
      const projectVersion =
        typeof safePackageJson?.version === 'string' ? safePackageJson.version : null;

      const directoryStructure = {
        name: projectName,
        version: projectVersion,
        hasPackageJson: packageJsonRaw !== null,
        hasTsconfig: hasTsconfig,
        hasReadme: readmeRaw !== null,
        hasDockerfile: dockerfileRaw !== null,
        hasCiWorkflow: ciWorkflowRaw !== null,
        detectedRoots: [
          ...(hasTsconfig ? ['.tsconfig'] : []),
          ...(dockerfileRaw !== null ? ['Dockerfile'] : []),
          ...(ciWorkflowRaw !== null ? ['.github/workflows'] : []),
        ],
        readmeSnippet: safeReadme ? safeReadme.slice(0, 500) : null,
      };

      // ── Step 6: Detect modules ────────────────────────────────────────────
      // Count major frameworks as modules for MVP
      const detectedModules = frameworks.map((fw) => ({
        name: fw,
        path: '/',
        type: 'framework',
      }));

      // Also add databases as modules
      for (const db of databases) {
        detectedModules.push({ name: db, path: '/', type: 'database' });
      }

      // ── Step 7: Call CompatibilityScorerService.calculate() ──────────────
      const analysisInput: AnalysisInput = {
        primaryLanguage,
        frameworks,
        databases,
        buildTools,
        detectedModules,
        testCoverage: null, // not available without running the project
        buildScripts: Object.keys(buildScripts).length > 0 ? buildScripts : null,
        directoryStructure,
      };

      const { score, tier, notes } = this.compatibilityScorer.calculate(analysisInput);

      this.logger.log(
        `Compatibility score for project ${projectId}: ${score}/100 (${tier})`,
      );

      // ── Step 8: Persist ProjectAnalysis ───────────────────────────────────
      const analysisData = {
        organizationId,
        primaryLanguage,
        frameworks,
        databases,
        buildTools,
        packageManager,
        compatibilityScore: score,
        compatibilityTier: tier,
        compatibilityNotes: notes as unknown as Prisma.JsonArray,
        directoryStructure: directoryStructure as unknown as Prisma.JsonObject,
        mainDependencies: mainDependencies as unknown as Prisma.JsonArray,
        detectedModules: detectedModules as unknown as Prisma.JsonArray,
        detectedEndpoints: Prisma.JsonNull,
        testCoverage: null,
        buildScripts:
          Object.keys(buildScripts).length > 0
            ? (buildScripts as unknown as Prisma.JsonObject)
            : Prisma.JsonNull,
        knownIssues: Prisma.JsonNull,
        analyzedAt: new Date(),
      };

      await this.prisma.projectAnalysis.upsert({
        where: { projectId },
        create: { projectId, ...analysisData },
        update: { ...analysisData },
      });

      // ── Step 8b: Calculate and save baseline tokens/cost ──────────────────
      // Estimate tokens from fetched file content (no AI was called, but we
      // represent the "cost" of reading the codebase at GPT-4o rates)
      const fetchedContents = [packageJsonRaw, tsconfigRaw, readmeRaw, dockerfileRaw, ciWorkflowRaw];
      const totalChars = fetchedContents.reduce(
        (sum, content) => sum + (content ? content.length : 0),
        0,
      );
      const baselineTokens = Math.ceil(totalChars / 4);
      const baselineCostUsd = (baselineTokens / 1_000_000) * 15; // GPT-4o rate

      await this.prisma.projectAnalysis.update({
        where: { projectId },
        data: { baselineTokens, baselineCostUsd },
      });

      // ── Step 9: Update Project status → ACTIVE ────────────────────────────
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'ACTIVE' },
      });

      // ── Step 10: Log ActivityLog entry ────────────────────────────────────
      await this.prisma.activityLog.create({
        data: {
          organizationId,
          projectId,
          eventType: 'STATE_CHANGE',
          friendlyMessage: `Phân tích dự án hoàn tất. Điểm tương thích: ${score}/100 (${tier}). Token cơ sở: ${baselineTokens}, chi phí: $${baselineCostUsd.toFixed(4)}.`,
          tokensUsed: baselineTokens,
          estimatedCost: baselineCostUsd,
          actorId: 'system',
        },
      });

      this.logger.log(`Analysis completed for project ${projectId}`);
    } catch (err: unknown) {
      this.logger.error(
        `Analysis failed for project ${projectId}`,
        err instanceof Error ? err.stack : String(err),
      );

      // Transition to ANALYSIS_FAILED
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'ANALYSIS_FAILED' },
      });

      await this.prisma.activityLog.create({
        data: {
          organizationId,
          projectId,
          eventType: 'ERROR',
          friendlyMessage:
            'Phân tích dự án thất bại. Vui lòng kiểm tra cấu hình GitHub và thử lại.',
          technicalDetail:
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : { message: String(err) },
          actorId: 'system',
        },
      });

      // Re-throw so BullMQ handles retry
      throw err;
    }
  }
}
