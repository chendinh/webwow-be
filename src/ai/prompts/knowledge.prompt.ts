/**
 * Prompt builders for Knowledge Branch document generation.
 *
 * Each method returns `{ system, user }` to be passed to IAIProvider.call().
 * System prompt enforces: output-only Markdown, starts with the required H1,
 * max 500 lines, no outer JSON or code fences.
 */

export interface RepoAnalysisData {
  projectName: string;
  defaultBranch: string;
  primaryLanguage: string;
  frameworks: string[];
  databases: string[];
  buildTools: string[];
  packageManager: string;
  packageJson: Record<string, unknown> | null;
  tsconfig: string | null;
  readmeSnippet: string | null;
  fileTree: string[];
  hasDockerfile: boolean;
  hasCiWorkflow: boolean;
}

// ─── Shared system prompt ─────────────────────────────────────────────────────

function buildSystem(docName: string): string {
  return `You are a technical documentation AI. Your task is to generate a single Markdown document called ${docName}.

CRITICAL RULES:
- Output ONLY valid Markdown — no JSON, no XML, no outer code fences wrapping the entire document.
- The very first line MUST be the H1 heading: # ${docName.replace(/\.md$/i, '')}
- Maximum 500 lines. If content would exceed 500 lines, truncate and append exactly: <!-- truncated: content exceeded 500 lines -->
- Do NOT include any preamble, explanation, or commentary outside the document itself.
- Write in English. Use clear, concise technical language.`;
}

// ─── KnowledgePrompt ──────────────────────────────────────────────────────────

export class KnowledgePrompt {
  /**
   * OVERVIEW.md — high-level product summary, user journey, key concepts.
   * This is the "executive brief" that gives AI the full picture before touching code.
   */
  static buildOverviewMd(data: RepoAnalysisData): { system: string; user: string } {
    const system = buildSystem('OVERVIEW.md');
    const user = `Generate OVERVIEW.md for the following project. This document is the most important context document — it must give an AI coding assistant a complete mental model of the product BEFORE it reads any code.

Project name: ${data.projectName}
Primary language: ${data.primaryLanguage}
Frameworks: ${data.frameworks.join(', ') || 'none detected'}
Databases: ${data.databases.join(', ') || 'none detected'}
Package manager: ${data.packageManager}
Has Dockerfile: ${data.hasDockerfile}
Has CI workflow: ${data.hasCiWorkflow}

package.json (full):
${JSON.stringify(data.packageJson ?? {}, null, 2).slice(0, 3000)}

${data.readmeSnippet ? `README (full excerpt):\n${data.readmeSnippet}` : ''}

File tree:
${data.fileTree.slice(0, 120).join('\n')}

REQUIRED SECTIONS (in this order):
1. # OVERVIEW
2. ## Product Summary — What does this product do? Who are the users? What problem does it solve? (4–8 sentences, product-level thinking)
3. ## Core User Journeys — Top 3–5 flows a user goes through (e.g., sign up → connect repo → create issue → AI codes → PR created). Use numbered steps.
4. ## Key Domain Concepts — Glossary of 8–15 domain terms specific to this project (e.g. "Issue", "AITask", "KnowledgeBranch"). One sentence each.
5. ## System Boundaries — What this system does vs does NOT do. External services it integrates with (GitHub, payment provider, etc.).
6. ## Data Flow — How data moves through the system at a high level (request → worker → AI → GitHub → PR). A short narrative or numbered sequence.
7. ## Critical Invariants — 5–10 rules that must NEVER be violated (e.g., "never commit to main directly", "always validate org ownership before DB writes"). These are constraints an AI must respect when writing code.
8. ## Known Limitations & Technical Debt — Current known issues, shortcuts taken, or areas that need improvement. Honest assessment.

Write from the perspective of a senior engineer onboarding a new AI teammate. Be specific, not generic.`;

    return { system, user };
  }

  /**
   * PROJECT.md — project purpose, tech stack, entry points.
   * Required sections: ## Overview, ## Technology Stack, ## Entry Points
   * Validates: Requirements 12.1
   */
  static buildProjectMd(data: RepoAnalysisData): { system: string; user: string } {
    const system = buildSystem('PROJECT.md');
    const user = `Generate PROJECT.md for the following project.

Project name: ${data.projectName}
Default branch: ${data.defaultBranch}
Primary language: ${data.primaryLanguage}
Frameworks: ${data.frameworks.join(', ') || 'none detected'}
Databases: ${data.databases.join(', ') || 'none detected'}
Build tools: ${data.buildTools.join(', ') || 'none'}
Package manager: ${data.packageManager}
Has Dockerfile: ${data.hasDockerfile}
Has CI workflow: ${data.hasCiWorkflow}

package.json (excerpt):
${JSON.stringify(data.packageJson ?? {}, null, 2).slice(0, 2500)}

${data.readmeSnippet ? `README (excerpt):\n${data.readmeSnippet}` : ''}

File tree (top-level):
${data.fileTree.slice(0, 80).join('\n')}

REQUIRED SECTIONS (in this order):
1. # PROJECT
2. ## Overview — 3–6 sentences describing the project purpose, target users, and core value proposition
3. ## Technology Stack — table or list of: primary language, runtime version (if detectable), frameworks, UI libraries, state management, ORM/database, job queues, auth mechanisms, external APIs
4. ## Project Structure — brief description of top-level directories and their responsibilities
5. ## Entry Points — root layout file, main server file, CLI entry, or equivalent. Include file path.
6. ## Development Setup — how to install and run locally (infer from scripts in package.json)
7. ## Environment Variables — list key env vars expected (infer from .env.example patterns or config files in the file tree)
8. ## Build & Deploy — build command, output directory, deployment target (infer from Dockerfile/CI if present)`;

    return { system, user };
  }

  /**
   * ARCHITECTURE.md — directory structure, patterns, module interactions.
   * Required sections: ## Directory Structure, ## Architectural Patterns, ## Module Interactions
   * Validates: Requirements 12.2
   */
  static buildArchitectureMd(
    data: RepoAnalysisData,
    fileTree: string[],
  ): { system: string; user: string } {
    const system = buildSystem('ARCHITECTURE.md');
    const user = `Generate ARCHITECTURE.md for the following project.

Project: ${data.projectName}
Primary language: ${data.primaryLanguage}
Frameworks: ${data.frameworks.join(', ') || 'none'}
Databases: ${data.databases.join(', ') || 'none'}
Build tools: ${data.buildTools.join(', ') || 'none'}

File tree (full, two levels deep):
${fileTree.slice(0, 150).join('\n')}

REQUIRED SECTIONS (in this order):
1. # ARCHITECTURE
2. ## Directory Structure — annotated two-level tree. For each top-level directory, add a one-line comment explaining its purpose.
3. ## Architectural Patterns — identified patterns with explanation of how they are applied here (e.g., MVC, layered architecture, modular monolith, queue-driven workers, App Router vs Pages Router, Server vs Client Components). Be specific, not generic.
4. ## Request Lifecycle — step-by-step flow of a typical HTTP request through the system (route → middleware → controller → service → DB → response)
5. ## Background Job Architecture — how async jobs work (queue names, worker types, job data shape, retry strategy)
6. ## Module Interactions — dependency graph narrative. Which modules depend on which. Avoid circular dependencies.
7. ## State Management — how client and server state is managed (Zustand stores, React context, server-side sessions, etc.)
8. ## Authentication & Authorization — how auth works end-to-end (token type, guard mechanism, org/project ownership checks)
9. ## Error Handling Strategy — how errors propagate (exceptions, HTTP codes, worker failure handling)`;

    return { system, user };
  }

  /**
   * MODULES.md — one section per detected module.
   * Validates: Requirements 12.3
   */
  static buildModulesMd(
    data: RepoAnalysisData,
    moduleFiles: string[],
  ): { system: string; user: string } {
    const system = buildSystem('MODULES.md');
    const user = `Generate MODULES.md for the following project.

Project: ${data.projectName}
Frameworks: ${data.frameworks.join(', ') || 'none'}

Detected module/feature files:
${moduleFiles.slice(0, 80).join('\n')}

File tree:
${data.fileTree.slice(0, 60).join('\n')}

INSTRUCTIONS:
- Create one section per detected module (NestJS @Module, Next.js route group, or top-level src/ directory).
- Each section must contain: Location (file path), Type (feature | utility | shared), Responsibility (1–2 sentences).
- Format each module as: ### <ModuleName>\n- **Location:** <path>\n- **Type:** <type>\n- **Responsibility:** <description>

Begin with:
# MODULES
## Module Index`;

    return { system, user };
  }

  /**
   * API.md — HTTP endpoints extracted from controller files.
   * Validates: Requirements 12.4
   */
  static buildApiMd(
    data: RepoAnalysisData,
    controllerFiles: string[],
    controllerContents: Array<{ path: string; content: string }>,
  ): { system: string; user: string } {
    const system = buildSystem('API.md');

    const contentSection = controllerContents
      .slice(0, 10)
      .map(f => `### ${f.path}\n\`\`\`typescript\n${f.content.slice(0, 1500)}\n\`\`\``)
      .join('\n\n');

    const user = `Generate API.md for the following project.

Project: ${data.projectName}
Frameworks: ${data.frameworks.join(', ') || 'none'}

Controller/route files detected:
${controllerFiles.join('\n')}

Controller file contents:
${contentSection}

INSTRUCTIONS:
- List every HTTP endpoint found in the controller files.
- For each endpoint include: HTTP method, full path, controller class name, 1–2 sentence description.
- Format: ### <METHOD> <path>\n- **Controller:** <ClassName>\n- **Description:** <text>

Begin with:
# API
## Endpoints`;

    return { system, user };
  }

  /**
   * DATABASE.md — ORM/driver, entities, relationships.
   * Only called when databases are detected.
   * Validates: Requirements 12.5
   */
  static buildDatabaseMd(
    data: RepoAnalysisData,
    schemaContent: string | null,
  ): { system: string; user: string } {
    const system = buildSystem('DATABASE.md');
    const user = `Generate DATABASE.md for the following project.

Project: ${data.projectName}
ORM / database drivers: ${data.databases.join(', ')}

${schemaContent ? `Prisma schema (excerpt):\n\`\`\`prisma\n${schemaContent.slice(0, 3000)}\n\`\`\`` : 'No schema file found — infer from dependencies.'}

INSTRUCTIONS:
- Include: ORM/driver name, a list of entity/model names with their primary key type.
- Include detected foreign-key relationships.
- Do NOT include resolved download URLs, integrity hashes, or lockfile content.

Begin with:
# DATABASE
## Overview`;

    return { system, user };
  }

  /**
   * DEPENDENCIES.md — categorised production dependencies from package.json.
   * Must NOT include URLs or lockfile content.
   * Validates: Requirements 12.6, 6.4
   */
  static buildDependenciesMd(
    data: RepoAnalysisData,
  ): { system: string; user: string } {
    const system = buildSystem('DEPENDENCIES.md');

    const deps = data.packageJson?.dependencies;
    const depsText =
      deps && typeof deps === 'object'
        ? Object.entries(deps as Record<string, string>)
            .map(([name, version]) => `${name}: ${version}`)
            .join('\n')
        : 'No dependencies found.';

    const user = `Generate DEPENDENCIES.md for the following project.

Project: ${data.projectName}

Production dependencies (from package.json — name and declared version only):
${depsText}

INSTRUCTIONS:
- Categorise each dependency into one of: UI Framework, ORM/Database, Queue, Auth, HTTP Client, Testing, or Other.
- Include ONLY the package name and version string as declared in package.json.
- Do NOT include any download URLs (https://), integrity hashes (sha512-), or lockfile content.

Begin with:
# DEPENDENCIES
## Production Dependencies`;

    return { system, user };
  }

  /**
   * CONVENTIONS.md — TypeScript, ESLint, Prettier settings.
   * Validates: Requirements 12.7
   */
  static buildConventionsMd(
    data: RepoAnalysisData,
    eslintContent: string | null,
    prettierContent: string | null,
  ): { system: string; user: string } {
    const system = buildSystem('CONVENTIONS.md');
    const user = `Generate CONVENTIONS.md for the following project.

Project: ${data.projectName}

tsconfig.json compilerOptions:
${data.tsconfig ? data.tsconfig.slice(0, 1500) : 'Not found'}

${eslintContent ? `.eslintrc content:\n${eslintContent.slice(0, 1000)}` : 'No ESLint config found.'}

${prettierContent ? `Prettier config:\n${prettierContent.slice(0, 500)}` : 'No Prettier config found.'}

INSTRUCTIONS:
- Present each setting as a named convention, not raw JSON.
- Sections: TypeScript, Linting, Formatting.

Begin with:
# CONVENTIONS
## TypeScript`;

    return { system, user };
  }

  /**
   * BUSINESS_RULES.md — inferred business/domain rules from validation and domain logic.
   * Validates: Requirements 12.8 (implied)
   */
  static buildBusinessRulesMd(
    data: RepoAnalysisData,
    domainFiles: Array<{ path: string; content: string }>,
  ): { system: string; user: string } {
    const system = buildSystem('BUSINESS_RULES.md');

    const domainSection = domainFiles
      .slice(0, 8)
      .map(f => `### ${f.path}\n\`\`\`typescript\n${f.content.slice(0, 1200)}\n\`\`\``)
      .join('\n\n');

    const user = `Generate BUSINESS_RULES.md for the following project.

Project: ${data.projectName}
Frameworks: ${data.frameworks.join(', ') || 'none'}

Domain/service files (excerpts):
${domainSection || 'No domain files provided.'}

INSTRUCTIONS:
- Infer business rules from validation logic, guards, decorators, and domain service methods.
- Group rules by domain area.
- Each rule: one sentence describing what is enforced, and where (file/class name).

Begin with:
# BUSINESS_RULES
## Rules`;

    return { system, user };
  }

  /**
   * FILE_INDEX.md — two-level directory tree, excluding build artifacts.
   * Validates: Requirements 12.8
   */
  static buildFileIndexMd(
    data: RepoAnalysisData,
    fileTree: string[],
  ): { system: string; user: string } {
    const system = buildSystem('FILE_INDEX.md');
    const user = `Generate FILE_INDEX.md for the following project.

Project: ${data.projectName}

Repository file tree (two levels, excluding node_modules, .git, dist, .next, build, .cache, coverage, example-ui):
${fileTree.slice(0, 150).join('\n')}

INSTRUCTIONS:
- Present as a clean two-level directory tree.
- Exclude: node_modules, .git, dist, .next, build, .cache, coverage, example-ui.
- Group files under their parent directory.

Begin with:
# FILE_INDEX
## Directory Tree`;

    return { system, user };
  }
}
