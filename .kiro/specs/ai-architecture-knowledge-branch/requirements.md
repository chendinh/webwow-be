# Requirements Document

## Introduction

Feature này implement một **AI Architecture Knowledge Branch** — một cơ chế lưu trữ kiến thức dự án bền vững (persistent project-knowledge) sử dụng một dedicated Git branch tên `ai/architecture`.

Mục tiêu cốt lõi: thay vì gửi toàn bộ repository cho Claude mỗi lần cần hiểu dự án, hệ thống duy trì một bộ tài liệu Markdown súc tích, version-controlled trên branch `ai/architecture`. Claude đọc knowledge này trước, sau đó chỉ inspect source code cần thiết cho task hiện tại — giảm đáng kể token usage và tăng chất lượng output.

Feature này mở rộng flow "Phân tích dự án" hiện có (trigger bởi `POST /api/projects/:projectId/reanalyze` và worker `project-analysis`) và bổ sung tab Architecture trên frontend Next.js 14.

**Phạm vi v1:** Tạo và cập nhật knowledge branch; UI hiển thị kết quả; tích hợp với CodingAgent/AnalysisAgent. Không bao gồm vector database, embeddings, RAG, hay autonomous PR creation.

---

## Glossary

- **Knowledge_Branch**: Git branch `ai/architecture` trong repository của khách hàng. Lưu trữ tài liệu Markdown do AI tạo ra về kiến trúc dự án.
- **AI_Manifest**: File `ai/architecture/AI_MANIFEST.json` — source of truth của Knowledge_Branch, tracking trạng thái từng tài liệu và commit nguồn.
- **Source_Branch**: Branch chính của dự án (thường là `main`), lấy từ `project.defaultBranch`.
- **Knowledge_Document**: Một file Markdown trong Knowledge_Branch (ví dụ: `PROJECT.md`, `ARCHITECTURE.md`).
- **Knowledge_Analyzer**: Service/worker NestJS xử lý luồng phân tích và cập nhật knowledge branch.
- **CodingAgent**: Agent AI hiện có (`src/ai/agents/coding.agent.ts`) thực hiện coding tasks.
- **AnalysisAgent**: Agent AI hiện có (`src/ai/agents/analysis.agent.ts`) thực hiện phân tích issue.
- **GithubService**: Service hiện có (`src/modules/github/github.service.ts`) thực hiện Git operations qua GitHub API.
- **ProjectAnalysisWorker**: BullMQ worker hiện có (`src/queue/workers/project-analysis.worker.ts`) xử lý phân tích dự án.
- **Incremental_Update**: Quá trình chỉ cập nhật các Knowledge_Document bị ảnh hưởng bởi code changes, thay vì regenerate toàn bộ.
- **Force_Reanalysis**: Hành động người dùng kích hoạt để regenerate toàn bộ tất cả Knowledge_Document bất kể trạng thái hiện tại.

---

## Requirements

### Requirement 1: Knowledge Branch Structure

**User Story:** As an AI agent, I want to read a structured knowledge branch before inspecting source code, so that I can understand the project without scanning the entire repository.

#### Acceptance Criteria

1. THE Knowledge_Branch SHALL contain the following files after a completed analysis: `AI_MANIFEST.json`, `PROJECT.md`, `ARCHITECTURE.md`, `MODULES.md`, `API.md`, `DATABASE.md`, `DEPENDENCIES.md`, `CONVENTIONS.md`, `BUSINESS_RULES.md`, `FILE_INDEX.md` — excluding any documents whose status is `"not_applicable"`.
2. WHEN the Knowledge_Analyzer completes an analysis run and the `ai/architecture` branch does not yet exist in the repository, THE Knowledge_Analyzer SHALL create the branch as an orphan branch (no shared history with application branches) before committing any documents.
3. THE AI_Manifest SHALL conform to the following JSON schema: `{ "schemaVersion": integer ≥ 1, "status": "complete" | "partial" | "failed", "knowledgeBranch": "ai/architecture", "sourceBranch": string, "sourceCommit": string (40-char SHA), "analyzedAt": ISO8601 datetime string, "documents": { [filename: one of the 10 defined filenames]: { "status": "complete" | "not_applicable" | "failed", "lastUpdatedCommit": string } } }`.
4. WHEN a Knowledge_Document's corresponding technology or concern is absent from the repository (e.g., no database layer for `DATABASE.md`, no HTTP API for `API.md`), THE Knowledge_Analyzer SHALL set that document's status to `"not_applicable"` in the AI_Manifest and SHALL NOT create the file in the Knowledge_Branch.
5. THE Knowledge_Branch SHALL NOT share commit history with the Source_Branch or any other application branch — it SHALL be created as a Git orphan branch (`git checkout --orphan`).
6. WHEN the Knowledge_Branch already exists and the Knowledge_Analyzer runs a subsequent analysis, THE Knowledge_Analyzer SHALL overwrite existing Knowledge_Documents with updated content and update the `analyzedAt` and `sourceCommit` fields in the AI_Manifest rather than creating a new branch.

---

### Requirement 2: Initial Analysis Workflow

**User Story:** As a developer, I want to trigger an initial analysis of my project, so that the AI knowledge base is created for the first time.

#### Acceptance Criteria

1. WHEN the Knowledge_Analyzer determines that the Knowledge_Branch does not exist in the repository, THE Knowledge_Analyzer SHALL perform an Initial Analysis.
2. WHEN performing an Initial Analysis, THE Knowledge_Analyzer SHALL execute the following steps in order: (a) create the `ai/architecture` branch as an orphan branch via GithubService, (b) scan the repository structure using deterministic tooling (file tree, `package.json`, TypeScript AST, static analysis), (c) call Claude only for semantic understanding requiring architectural interpretation, (d) generate all applicable Knowledge_Documents, (e) write the AI_Manifest with `status: "complete"` and the current `sourceCommit`, (f) commit all documents to the Knowledge_Branch with message `"ai: initialize architecture knowledge"`.
3. THE Knowledge_Analyzer SHALL use GithubService to perform all Git operations (branch creation, file writes, commits) via the GitHub API — it SHALL NOT use local git CLI commands.
4. WHEN an Initial Analysis starts, THE Knowledge_Analyzer SHALL upsert a `KnowledgeAnalysis` record for the project with `analysisStatus: "RUNNING"`. WHEN the analysis completes successfully, THE Knowledge_Analyzer SHALL update the record to `analysisStatus: "COMPLETE"` and set `lastAnalyzedCommit` to the `sourceCommit` value written to the AI_Manifest.
5. IF an Initial Analysis fails after at least one Knowledge_Document has been committed, THEN THE Knowledge_Analyzer SHALL update the AI_Manifest with `status: "partial"`, commit the partial manifest, and set the `KnowledgeAnalysis` record to `analysisStatus: "PARTIAL"` — allowing the next analysis trigger to resume by processing only documents whose per-document status in the AI_Manifest is not `"complete"`.

---

### Requirement 3: Incremental Update Workflow

**User Story:** As a developer, I want the AI knowledge to update only the affected documents when my code changes, so that unnecessary AI calls are avoided and costs are minimized.

#### Acceptance Criteria

1. WHEN the Knowledge_Branch already exists AND the AI_Manifest's `sourceCommit` matches the current HEAD of the Source_Branch AND all documents listed in the AI_Manifest have `status: "complete"`, THE Knowledge_Analyzer SHALL stop immediately without calling Claude or making any Git commits.
2. WHEN the Knowledge_Branch exists and the `sourceCommit` in the AI_Manifest differs from the current HEAD of the Source_Branch, THE Knowledge_Analyzer SHALL call GithubService to obtain a `git diff --name-only` between the recorded `sourceCommit` and the current HEAD, producing a list of changed file paths.
3. WHEN performing Incremental_Update, THE Knowledge_Analyzer SHALL apply the following change-to-document mapping rules in priority order (first matching rule wins): (1) any file whose path matches `prisma/schema.prisma` or `prisma/migrations/**` → update `DATABASE.md`; (2) any file whose name contains `controller` or whose path matches `src/api/**` or `src/routes/**` → update `API.md`; (3) any file whose path matches `package.json` or `**/package.json` → update `DEPENDENCIES.md`; (4) any file whose path matches `.eslintrc*`, `tsconfig.json`, or `prettier.config.*` → update `CONVENTIONS.md`; (5) any remaining file under `src/**` → update both `ARCHITECTURE.md` and `MODULES.md`.
4. IF a changed file matches one of the mapping rules in criterion 3, THEN THE Knowledge_Analyzer SHALL call Claude to regenerate only the Knowledge_Documents mapped to that rule, passing only the source files relevant to that document as context.
5. WHEN an Incremental_Update completes, THE Knowledge_Analyzer SHALL update the AI_Manifest with the new `sourceCommit` and set `analyzedAt` to the current timestamp in ISO 8601 format.
6. IF GithubService fails to retrieve the git diff or the recorded `sourceCommit` is no longer reachable in the repository, THEN THE Knowledge_Analyzer SHALL abort the Incremental_Update without modifying the AI_Manifest or any Knowledge_Documents, and SHALL set the `KnowledgeAnalysis` record to `analysisStatus: "FAILED"` with a Vietnamese error message.
7. IF the changed files produce no matches against the mapping rules in criterion 3, THEN THE Knowledge_Analyzer SHALL skip all Claude calls and SHALL update only the `sourceCommit` and `analyzedAt` fields in the AI_Manifest to reflect the new HEAD.

---

### Requirement 4: Force Re-analysis

**User Story:** As a developer, I want to force-regenerate all knowledge documents, so that I can reset the knowledge base when I believe it has become stale or inaccurate.

#### Acceptance Criteria

1. WHEN a user triggers a Force_Reanalysis, THE Knowledge_Analyzer SHALL regenerate all applicable Knowledge_Documents regardless of their current status or whether the `sourceCommit` has changed.
2. WHEN performing Force_Reanalysis, THE Knowledge_Analyzer SHALL: (a) delete all existing Knowledge_Documents from the Knowledge_Branch via GithubService, (b) generate all applicable documents from current source, (c) commit the regenerated documents and an updated AI_Manifest with `status: "complete"`, `sourceCommit` set to current HEAD, and `analyzedAt` set to the current ISO 8601 timestamp, using commit message `"ai: force re-analyze architecture knowledge"`.
3. THE Knowledge_Analyzer SHALL expose Force_Reanalysis as a separate API endpoint (`POST /api/projects/:projectId/knowledge/force-analyze`) distinct from the incremental endpoint, so that the UI can offer it as a dedicated "Phân tích lại toàn bộ" action.
4. WHILE any analysis (incremental or force) is in progress for a project, THE Knowledge_Analyzer SHALL reject additional analysis requests for the same project with HTTP 409 and a Vietnamese error message.
5. IF a Force_Reanalysis fails after documents have been deleted but before new documents are committed, THEN THE Knowledge_Analyzer SHALL commit an AI_Manifest with `status: "partial"` to preserve the branch and SHALL set the `KnowledgeAnalysis` record to `analysisStatus: "PARTIAL"`, allowing the next trigger to resume from the documents not yet committed.

---

### Requirement 5: Claude Usage Policy

**User Story:** As a platform operator, I want Claude to be called only when necessary, so that API costs are controlled and latency is minimized.

#### Acceptance Criteria

1. THE Knowledge_Analyzer SHALL use deterministic tooling (GithubService file tree, `package.json` parsing, TypeScript AST, static analysis of controller/schema files) to extract all machine-readable data before calling Claude for any Knowledge_Document generation.
2. THE Knowledge_Analyzer SHALL call Claude only for the following purposes: (a) generating narrative summaries of architectural patterns for `ARCHITECTURE.md`, (b) inferring business rules from validation and domain logic for `BUSINESS_RULES.md`, (c) describing module responsibilities in natural language for `MODULES.md`, and (d) summarizing project purpose for `PROJECT.md`. For all other documents (`API.md`, `DATABASE.md`, `DEPENDENCIES.md`, `CONVENTIONS.md`, `FILE_INDEX.md`), Claude SHALL NOT be called unless deterministic extraction fails to produce a non-empty result.
3. IF all Knowledge_Documents in the AI_Manifest have `status: "complete"` AND the recorded `sourceCommit` equals the current HEAD of the Source_Branch, THEN THE Knowledge_Analyzer SHALL NOT call Claude and SHALL return without making any Git commits.
4. THE Knowledge_Analyzer SHALL NOT send the entire repository to Claude. For each Knowledge_Document being generated, THE Knowledge_Analyzer SHALL send only the source files relevant to that specific document type as defined in Requirement 12's per-document content rules.
5. WHEN calling Claude for knowledge generation, THE Knowledge_Analyzer SHALL log the AI call to `ActivityLog` with: `eventType: "AI_CALL"`, `agentType: "KnowledgeAnalyzer"`, `documentType` (the Knowledge_Document being generated), and `inputTokens` and `outputTokens` as returned by the Claude API response. IF the ActivityLog write fails, THE Knowledge_Analyzer SHALL log a warning but SHALL NOT abort the analysis.

---

### Requirement 6: Knowledge Branch Security

**User Story:** As a platform operator, I want the knowledge branch to be free of secrets and credentials, so that sensitive information is not accidentally committed to the repository.

#### Acceptance Criteria

1. THE Knowledge_Analyzer SHALL NOT read, include, or reference the content of `.env`, `.env.*`, `.env.local`, `.env.production`, or any file matching the pattern `*.pem`, `*.key`, `*secret*`, or `*credential*` when generating any Knowledge_Document.
2. THE Knowledge_Analyzer SHALL apply secret masking (reusing `ProjectAnalysisWorker.maskSecrets`) to all source file content before passing it to Claude or writing it to any Knowledge_Document.
3. THE Knowledge_Analyzer SHALL NOT log GitHub installation tokens, OAuth tokens, API keys, or any value that matches a credential pattern to `ActivityLog`, application logs, or the `KnowledgeAnalysis` error message field.
4. THE Knowledge_Analyzer SHALL record only dependency names and version range strings in `DEPENDENCIES.md` — it SHALL NOT include any resolved download URLs, integrity hashes, or lockfile content from `package-lock.json` or `yarn.lock`.

---

### Requirement 7: Operational Metadata Storage

**User Story:** As a platform operator, I want the analysis state to be stored in the database, so that the system can track progress, display status in the UI, and resume partial analyses.

#### Acceptance Criteria

1. THE Knowledge_Analyzer SHALL upsert a `KnowledgeAnalysis` Prisma model record keyed on `projectId`, storing: `analysisStatus` (enum: `PENDING` | `RUNNING` | `COMPLETE` | `PARTIAL` | `FAILED`), `lastAnalyzedCommit` (the `sourceCommit` value from the last completed or partial AI_Manifest), `lastAnalyzedAt` (timestamp of last successful completion), and `lastErrorMessage` (nullable string, set on failure). The model SHALL also store `organizationId` for multi-tenant scoping.
2. THE Knowledge_Analyzer SHALL NOT store Knowledge_Document Markdown content in the database — the `KnowledgeAnalysis` record SHALL contain only operational metadata; Git is the sole source of truth for document content.
3. WHEN an analysis transitions to `analysisStatus: "FAILED"`, THE Knowledge_Analyzer SHALL set `lastErrorMessage` to a human-readable Vietnamese string of no more than 500 characters describing the failure cause, suitable for display in the UI.
4. ALL `KnowledgeAnalysis` records SHALL include both `projectId` and `organizationId` foreign keys. THE Knowledge_Analyzer SHALL validate that the requesting user's `organizationId` matches the record's `organizationId` before returning status or accepting trigger requests.

---

### Requirement 8: BullMQ Queue Integration

**User Story:** As a backend developer, I want knowledge analysis to run as an asynchronous BullMQ job, so that the API responds immediately and analysis runs in the background without blocking the request cycle.

#### Acceptance Criteria

1. THE Knowledge_Analyzer SHALL be implemented as a new BullMQ `@Processor('knowledge-analysis')` worker class and a corresponding queue registration in `queue.constants.ts` and `QueueService`, following the same structural pattern as `ProjectAnalysisWorker`.
2. WHEN a knowledge analysis endpoint (`/analyze` or `/force-analyze`) is called, THE API controller SHALL enqueue a job to the `knowledge-analysis` queue via `QueueService` with a payload of type `KnowledgeAnalysisJobData` containing: `projectId: string`, `organizationId: string`, `forceReanalysis: boolean`, and `triggeredBy: "user" | "system"`. IF a job for the same `projectId` is already in `waiting` or `active` state in the queue, THE controller SHALL return HTTP 409 without enqueuing a duplicate job.
3. THE Knowledge_Analyzer worker SHALL use the following retry policy: maximum 3 attempts, with backoff delays of 30 s, 60 s, and 120 s respectively (exponential backoff starting at 30 seconds), matching the pattern in `project-analysis.worker.ts`.
4. THE Knowledge_Analyzer worker SHALL run with `concurrency: 3`, matching `CONCURRENCY.PROJECT_ANALYSIS` defined in `queue.constants.ts`.
5. WHEN the `ProjectAnalysisWorker` completes a project analysis job successfully, it SHALL call `QueueService.enqueueKnowledgeAnalysis({ projectId, organizationId, forceReanalysis: false, triggeredBy: "system" })` — this enqueue SHALL be the only automatic trigger; knowledge analysis SHALL NOT be enqueued directly on project creation.

---

### Requirement 9: CodingAgent and AnalysisAgent Integration

**User Story:** As an AI agent, I want to read from the knowledge branch before starting any coding or analysis task, so that I have full project context without scanning the entire repository.

#### Acceptance Criteria

1. WHEN a CodingAgent or AnalysisAgent task starts for a project, THE agent SHALL first call GithubService to attempt reading `ai/architecture/AI_MANIFEST.json`. IF the file is not found (404) or the GitHub API call fails, THE agent SHALL proceed to step 3.
2. WHEN the AI_Manifest is successfully read AND its `status` is `"complete"`, THE agent SHALL read the following Knowledge_Documents from the Knowledge_Branch before reading any source files: for coding tasks — `PROJECT.md`, `ARCHITECTURE.md`, `MODULES.md`, `FILE_INDEX.md`; for analysis/planning tasks — `PROJECT.md`, `ARCHITECTURE.md`, `MODULES.md`, `API.md`, `BUSINESS_RULES.md`.
3. WHEN the AI_Manifest does not exist, cannot be parsed, or has `status` of `"failed"` or `"partial"`, THE agent SHALL proceed without knowledge branch context and SHALL log to `ActivityLog` with `eventType: "WARN"` and message `"Knowledge branch unavailable or incomplete — proceeding without architecture context"`.
4. WHEN the AI_Manifest `status` is `"complete"` but a specific Knowledge_Document listed in criterion 2 has per-document `status: "not_applicable"`, THE agent SHALL skip that document and SHALL NOT request it from GithubService.
5. THE Knowledge_Documents read by agents SHALL be prepended to the Claude prompt context under a clearly labeled section header: `## Project Architecture Knowledge (ai/architecture)\n\n`, before any live source file content, so Claude can distinguish pre-analyzed knowledge from live source code.

---

### Requirement 10: Backend API Endpoints

**User Story:** As a frontend developer, I want dedicated API endpoints for knowledge branch operations, so that the UI can trigger analysis, poll status, and display results.

#### Acceptance Criteria

1. THE System SHALL expose `POST /api/projects/:projectId/knowledge/analyze` which enqueues an incremental knowledge analysis job and returns HTTP 202 with body `{ "message": "Phân tích kiến trúc đã được xếp hàng." }`.
2. THE System SHALL expose `POST /api/projects/:projectId/knowledge/force-analyze` which enqueues a Force_Reanalysis job and returns HTTP 202 with body `{ "message": "Phân tích lại toàn bộ đã được xếp hàng." }`.
3. THE System SHALL expose `GET /api/projects/:projectId/knowledge/status` which reads the `KnowledgeAnalysis` record and returns: `analysisStatus`, `lastAnalyzedCommit`, `lastAnalyzedAt`, `lastErrorMessage`, and — when `analysisStatus` is `COMPLETE` or `PARTIAL` — the per-document status map from the live AI_Manifest read via GithubService.
4. ALL three knowledge endpoints SHALL require a valid JWT (`JwtAuthGuard`) and SHALL validate that the `projectId` belongs to the authenticated user's `organizationId` — returning HTTP 403 if the project does not belong to that organization.
5. WHEN a knowledge analysis is already in `RUNNING` state for a project (either in the queue or actively processing) and a new `POST /analyze` or `POST /force-analyze` is received, THE System SHALL return HTTP 409 with body `{ "error": "Phân tích kiến trúc đang chạy cho dự án này. Vui lòng đợi hoàn tất." }`.

---

### Requirement 11: Frontend UI — Architecture Tab

**User Story:** As a developer, I want to see the knowledge branch status and trigger analysis from the project's Architecture tab, so that I can manage and monitor AI knowledge without leaving the platform.

#### Acceptance Criteria

1. THE Architecture_Page (at `/projects/[projectId]/architecture`) SHALL display the current knowledge analysis progress using the following ordered steps: "Kiểm tra repository...", "Đọc AI manifest...", "Phát hiện thay đổi...", "Phân tích với AI...", "Cập nhật tài liệu...", "Hoàn tất" — each step rendered as active, completed, or pending based on the current `analysisStatus` returned by the status endpoint.
2. WHEN the analysis `analysisStatus` is `COMPLETE` or `PARTIAL`, THE Architecture_Page SHALL display for each of the 10 Knowledge_Documents: a green checkmark icon for `status: "complete"`, a grey circle icon for `status: "not_applicable"`, and a red error icon for `status: "failed"` or when the document is absent from the manifest.
3. WHEN the status endpoint returns `analysisStatus: "COMPLETE"` AND includes a flag `alreadyUpToDate: true`, THE Architecture_Page SHALL display the message: "Kiến trúc dự án đã được cập nhật. Không cần gọi AI." in place of the progress steps.
4. THE Architecture_Page SHALL provide a "Phân tích lại" button that calls `POST /knowledge/analyze` and a "Phân tích lại toàn bộ" button that calls `POST /knowledge/force-analyze`. Both buttons SHALL be disabled and show a loading spinner while `analysisStatus` is `RUNNING`.
5. WHILE `analysisStatus` is `RUNNING`, THE Architecture_Page SHALL poll `GET /knowledge/status` every 3 seconds using TanStack Query `refetchInterval`. THE polling SHALL stop automatically when `analysisStatus` transitions to `COMPLETE`, `PARTIAL`, or `FAILED`.
6. THE Architecture_Page SHALL display in a results panel: the `lastAnalyzedCommit` truncated to its first 7 characters, the `lastAnalyzedAt` timestamp formatted as a human-readable local date-time, and the knowledge branch name `ai/architecture`.
7. WHEN `analysisStatus` is `FAILED`, THE Architecture_Page SHALL display the `lastErrorMessage` string from the status response. IF `lastErrorMessage` is null or empty, THE page SHALL display the fallback: "Phân tích thất bại. Vui lòng thử lại."

---

### Requirement 12: Knowledge Document Content Standards

**User Story:** As an AI agent, I want each knowledge document to follow a consistent, predictable structure, so that I can reliably extract project information without parsing ambiguous formats.

#### Acceptance Criteria

1. THE Knowledge_Analyzer SHALL generate `PROJECT.md` with a mandatory `## Overview` section (2–5 sentences describing project purpose), a `## Technology Stack` section (primary language, frameworks, package manager), and an `## Entry Points` section (root layout, main server file, or equivalent).
2. THE Knowledge_Analyzer SHALL generate `ARCHITECTURE.md` with a mandatory `## Directory Structure` section (two-level tree), an `## Architectural Patterns` section (identified patterns such as MVC, layered, modular monolith), and a `## Module Interactions` section (1–3 sentence narrative per major boundary).
3. THE Knowledge_Analyzer SHALL generate `MODULES.md` with one section per detected module, each containing: `Location` (file path), `Type` (feature | utility | shared), and `Responsibility` (1–2 sentences). THE Knowledge_Analyzer SHALL detect modules by scanning for NestJS `@Module()` decorators, Next.js route groups, or top-level directories under `src/`.
4. THE Knowledge_Analyzer SHALL generate `API.md` by statically analyzing files whose names contain `controller` or that reside under `src/api/` or `src/routes/`, extracting HTTP method, path, and controller name for each endpoint — without executing the code. Each endpoint entry SHALL contain: HTTP method, full path, controller class name, and a description of 1–2 sentences.
5. THE Knowledge_Analyzer SHALL generate `DATABASE.md` only when `prisma/schema.prisma`, a `typeorm` dependency, or a `mongoose` dependency is detected. The document SHALL contain: ORM/driver name, a list of entity/model names with their primary key type, and detected foreign-key relationships.
6. THE Knowledge_Analyzer SHALL generate `DEPENDENCIES.md` by parsing `package.json` `dependencies` (not `devDependencies`), categorizing each into: UI Framework, ORM/Database, Queue, Auth, HTTP Client, Testing, or Other. Each entry SHALL include the package name and version string as declared in `package.json`.
7. THE Knowledge_Analyzer SHALL generate `CONVENTIONS.md` by extracting: `compilerOptions` from `tsconfig.json`, `rules` and `extends` from `.eslintrc*`, and `printWidth`/`singleQuote`/`trailingComma` from `prettier.config.*` — presenting each setting as a named convention rather than raw JSON.
8. THE Knowledge_Analyzer SHALL generate `FILE_INDEX.md` as a two-level directory tree of the repository root, excluding: `node_modules`, `.git`, `dist`, `.next`, `build`, `.cache`, `coverage`, and any directory named `example-ui`.
9. WHEN generating any Knowledge_Document, IF the generated content exceeds 500 lines, THE Knowledge_Analyzer SHALL truncate the document at 500 lines and append a final line: `<!-- truncated: content exceeded 500 lines -->`. Each Knowledge_Document SHALL begin with a mandatory `# <DOCUMENT_NAME>` H1 heading matching its filename (without extension).
