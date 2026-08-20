# Implementation Plan: AI Architecture Knowledge Branch

## Overview

Implement the Knowledge Branch feature end-to-end: Prisma schema migration, BullMQ queue infrastructure, KnowledgeAnalysisWorker, GithubService extensions, KnowledgeModule (service + controller), KnowledgeReaderAgent, CodingAgent/AnalysisAgent integration, and the Frontend Architecture page rewrite.

## Tasks

- [x] 1. Prisma schema migration — add KnowledgeAnalysis model
  - [x] 1.1 Add `KnowledgeAnalysisStatus` enum and `KnowledgeAnalysis` model to `prisma/schema.prisma`
    - Add enum: `PENDING | RUNNING | COMPLETE | PARTIAL | FAILED`
    - Add model with fields: `id`, `projectId` (unique), `organizationId`, `analysisStatus`, `lastAnalyzedCommit`, `lastAnalyzedAt`, `lastErrorMessage`, `createdAt`, `updatedAt`
    - Add `@@index([organizationId])` and `@@index([projectId])`
    - Add optional relation `knowledgeAnalysis KnowledgeAnalysis?` to the `Project` model
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ]* 1.2 Write property test for KnowledgeAnalysis status state machine
    - **Property 4: Analysis Status State Machine**
    - **Validates: Requirements 2.4, 2.5, 4.5**
    - Use `fast-check` to assert valid transitions: PENDING → RUNNING → (COMPLETE | PARTIAL | FAILED); no record stays in RUNNING after worker exits

- [x] 2. Queue infrastructure — constants, types, and QueueService extension
  - [x] 2.1 Add `KNOWLEDGE_ANALYSIS` to `QUEUES` and `CONCURRENCY` in `src/queue/queue.constants.ts`
    - `QUEUES.KNOWLEDGE_ANALYSIS = 'knowledge-analysis'`
    - `CONCURRENCY.KNOWLEDGE_ANALYSIS = 3`
    - _Requirements: 8.1, 8.4_

  - [x] 2.2 Add `KnowledgeAnalysisJobData` interface to `src/queue/queue.types.ts`
    - Fields: `projectId: string`, `organizationId: string`, `forceReanalysis: boolean`, `triggeredBy: 'user' | 'system'`
    - _Requirements: 8.2_

  - [x] 2.3 Extend `src/queue/queue.service.ts` with `enqueueKnowledgeAnalysis()` and `getKnowledgeQueue()`
    - Inject `@InjectQueue(QUEUES.KNOWLEDGE_ANALYSIS)` queue
    - `enqueueKnowledgeAnalysis(data: KnowledgeAnalysisJobData)` — same retry policy as `enqueueProjectAnalysis` (3 attempts, exponential backoff 30 s)
    - `getKnowledgeQueue()` — return the queue instance (needed by KnowledgeService duplicate-job check)
    - Register queue in `queue.module.ts` via `BullModule.registerQueue`
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 3. Knowledge types and constants
  - [x] 3.1 Create `src/modules/knowledge/types/knowledge.types.ts`
    - Export `KNOWLEDGE_BRANCH`, `AI_MANIFEST_PATH`, `KNOWLEDGE_DOCUMENTS` tuple, `KnowledgeDocumentName` type
    - Export `DocumentStatus`, `ManifestStatus`, `AIManifest` interface
    - Export `KnowledgeStatusDto` interface
    - Export `CHANGE_MAPPING` array and `mapChangesToDocuments()` pure function (first-match-wins logic)
    - Export `SECRET_PATTERNS` regex array and `maskSecrets()` / `filterSafeFiles()` / `isExcludedPattern()` helper functions (reuse patterns from `project-analysis.worker.ts`)
    - Export `buildVietnameseError()` function
    - _Requirements: 1.1, 1.3, 3.3, 6.1, 6.2_

  - [ ]* 3.2 Write property test for `mapChangesToDocuments()` — determinism and first-match-wins
    - **Property 3: Change-to-Document Mapping Determinism**
    - **Validates: Requirements 3.3**
    - Use `fast-check` with `fc.array(fc.oneof(...))` of known path patterns; assert same output for same input and that a single-file input maps to exactly one rule's documents

  - [ ]* 3.3 Write property test for `maskSecrets()` — all patterns masked
    - **Property 8: Secret Masking Before Claude**
    - **Validates: Requirements 6.2**
    - Use `fast-check` to generate strings embedding `sk-*`, `ghp_*`, and base64 ≥ 40 chars; assert output contains `[MASKED]` and does not contain the original secret string

  - [ ]* 3.4 Write property test for `filterSafeFiles()` — excluded patterns never pass through
    - **Property 7: Secret Exclusion from Claude Context**
    - **Validates: Requirements 6.1**
    - Use `fast-check` to generate arrays of paths mixing `.env`, `*.pem`, `*.key`, `*secret*`, and normal `src/**` paths; assert excluded patterns are absent from the filtered result

- [x] 4. GithubService extensions
  - [x] 4.1 Add `createOrphanBranch()` to `src/modules/github/github.service.ts`
    - Create an empty tree → create orphan commit (parents: []) → create ref `refs/heads/ai/architecture`
    - _Requirements: 1.2, 1.5, 2.2_

  - [x] 4.2 Add `getFileContent()` to `src/modules/github/github.service.ts`
    - Fetch a single file from a specific `ref`; return `string | null` (null on 404)
    - _Requirements: 9.1, 3.2_

  - [x] 4.3 Add `getCommitDiff()` to `src/modules/github/github.service.ts`
    - Call `GET /repos/{owner}/{repo}/compare/{base}...{head}` and return array of changed file paths
    - _Requirements: 3.2_

  - [x] 4.4 Add `deleteFiles()` to `src/modules/github/github.service.ts`
    - Delete multiple files in a single commit on a branch using Git tree API (set `sha: null` for deletions)
    - _Requirements: 4.2_

  - [x] 4.5 Add `getBranchHeadSha()` to `src/modules/github/github.service.ts`
    - Call `GET /repos/{owner}/{repo}/git/ref/heads/{branch}`; return SHA or null on 404
    - _Requirements: 3.1, 3.2_

- [x] 5. Knowledge prompts
  - [x] 5.1 Create `src/ai/prompts/knowledge.prompt.ts` with document prompt builders
    - Implement `KnowledgePrompt.buildProjectMd()`, `buildArchitectureMd()`, `buildModulesMd()`, `buildApiMd()`, `buildDatabaseMd()`, `buildDependenciesMd()`, `buildConventionsMd()`, `buildBusinessRulesMd()`, `buildFileIndexMd()`
    - Each method returns `{ system: string; user: string }`
    - System prompt: output-only Markdown starting with `# <DOC_NAME>`, max 500 lines, no JSON or outer code fences
    - Per-document user prompts include only relevant source files (matches Req 5.4 per-document content rules)
    - _Requirements: 5.1, 5.2, 12.1–12.9_

  - [ ]* 5.2 Write property test for required document sections
    - **Property 12: Required Document Sections**
    - **Validates: Requirements 12.1, 12.2, 12.9**
    - Use `fast-check` to generate arbitrary repo input shapes; assert `PROJECT.md` output contains `## Overview`, `## Technology Stack`, `## Entry Points`; `ARCHITECTURE.md` output contains `## Directory Structure`, `## Architectural Patterns`, `## Module Interactions`; every document begins with the correct H1

- [x] 6. KnowledgeAnalysisWorker
  - [x] 6.1 Create `src/queue/workers/knowledge-analysis.worker.ts`
    - `@Processor(QUEUES.KNOWLEDGE_ANALYSIS, { concurrency: CONCURRENCY.KNOWLEDGE_ANALYSIS })`
    - On start: upsert `KnowledgeAnalysis` record → `RUNNING`
    - Routing logic: fetch AI_MANIFEST via `getFileContent()`; if 404 or parse error → Initial Analysis; if `forceReanalysis=true` → Force Analysis; if `sourceCommit == HEAD` and all complete → no-op; else → Incremental Update
    - Initial Analysis: `createOrphanBranch()` → generate all docs → commit with message `"ai: initialize architecture knowledge"` → upsert manifest → update record → `COMPLETE`
    - Incremental Update: `getCommitDiff()` → `mapChangesToDocuments()` → generate only affected docs → update manifest → update record → `COMPLETE`
    - Force Analysis: `deleteFiles()` all existing docs → generate all docs → commit with `"ai: force re-analyze architecture knowledge"` → update record → `COMPLETE`
    - No-op: return immediately, set `alreadyUpToDate: true` in status response
    - Partial failure: continue remaining docs, commit partial manifest with `status: "partial"`, set record → `PARTIAL`
    - Error handler: set record → `FAILED` with Vietnamese error message; re-throw for BullMQ retry
    - Log each Claude call to `ActivityLog` with `eventType: 'AI_CALL'`, `agentType: 'KnowledgeAnalyzer'`, `documentType`, `tokensUsed`
    - Apply `maskSecrets()` and `filterSafeFiles()` before passing any content to Claude
    - _Requirements: 2.1–2.5, 3.1–3.7, 4.1–4.5, 5.1–5.5, 6.1–6.4, 7.1–7.3, 8.1–8.5_

  - [ ]* 6.2 Write property test for no-op guard idempotence
    - **Property 5: No-Op Guard — Idempotence When Up-to-Date**
    - **Validates: Requirements 3.1, 5.3**
    - Use `fast-check` with `fc.hexaString({ minLength: 40, maxLength: 40 })` to generate SHAs; assert zero Claude calls and zero Git commits when manifest is `complete` and `sourceCommit == HEAD`

  - [ ]* 6.3 Write property test for manifest–file consistency
    - **Property 1: Manifest–File Consistency**
    - **Validates: Requirements 1.1, 1.4**
    - Use `fast-check` to generate manifest document status maps; assert that committed file set equals exactly the docs with `status: "complete"`

  - [ ]* 6.4 Write property test for incremental scoping
    - **Property 6: Incremental Scoping — Claude Called Only for Mapped Documents**
    - **Validates: Requirements 3.4, 5.2**
    - Use `fast-check` with arrays of changed file paths; assert Claude is called exactly for docs returned by `mapChangesToDocuments()` — no more, no fewer

  - [ ]* 6.5 Write property test for ActivityLog credential safety
    - **Property 9: ActivityLog Credential Safety**
    - **Validates: Requirements 6.3**
    - Use `fast-check` to generate ActivityLog `friendlyMessage` and `technicalDetail` strings; assert none contain `ghs_`, `sk-`, or high-entropy base64 patterns

  - [ ]* 6.6 Write property test for DEPENDENCIES.md content constraint
    - **Property 10: DEPENDENCIES.md Content Constraint**
    - **Validates: Requirements 6.4**
    - Use `fast-check` to generate `package.json` `dependencies` objects; assert generated `DEPENDENCIES.md` contains no `https://`, `sha512-`, or lockfile content

  - [x] 6.7 Register `KnowledgeAnalysisWorker` in `src/queue/queue.module.ts`
    - Add to providers array alongside existing workers
    - _Requirements: 8.1_

- [x] 7. Trigger ProjectAnalysisWorker → enqueueKnowledgeAnalysis
  - [x] 7.1 Modify `src/queue/workers/project-analysis.worker.ts` to call `queueService.enqueueKnowledgeAnalysis()` on success
    - Inject `QueueService` via constructor
    - After Step 9 (project status → ACTIVE), call `enqueueKnowledgeAnalysis({ projectId, organizationId, forceReanalysis: false, triggeredBy: 'system' })`
    - Wrap in try/catch — failure to enqueue knowledge analysis must NOT fail the project analysis job
    - _Requirements: 8.5_

- [x] 8. KnowledgeModule — service and controller
  - [x] 8.1 Create `src/modules/knowledge/knowledge.service.ts`
    - `enqueueAnalysis(projectId, organizationId, force)`: check DB record for RUNNING → check BullMQ waiting/active jobs → enqueue via `QueueService`; throw `ConflictException` (409) with Vietnamese message if duplicate
    - `getStatus(projectId, organizationId)`: read `KnowledgeAnalysis` record; if COMPLETE or PARTIAL, also read live AI_MANIFEST via `GithubService.getFileContent()` and include per-document statuses in response
    - Validate `organizationId` ownership by checking project belongs to the org (throw `ForbiddenException` if not)
    - _Requirements: 4.4, 7.4, 10.1–10.5_

  - [x] 8.2 Create `src/modules/knowledge/knowledge.controller.ts`
    - `POST /api/projects/:projectId/knowledge/analyze` → HTTP 202 `{ message: "Phân tích kiến trúc đã được xếp hàng." }`
    - `POST /api/projects/:projectId/knowledge/force-analyze` → HTTP 202 `{ message: "Phân tích lại toàn bộ đã được xếp hàng." }`
    - `GET /api/projects/:projectId/knowledge/status` → `KnowledgeStatusDto`
    - All endpoints: `@UseGuards(JwtAuthGuard)`, extract `organizationId` from query param
    - _Requirements: 10.1–10.5_

  - [x] 8.3 Create `src/modules/knowledge/knowledge.module.ts` and wire into `AppModule`
    - Declare `KnowledgeService`, `KnowledgeController`; import `PrismaModule`, `QueueModule`, `GithubModule`
    - Register in `src/app.module.ts`
    - _Requirements: 8.1, 10.1_

- [x] 9. Checkpoint — backend core complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. KnowledgeReaderAgent
  - [x] 10.1 Create `src/ai/agents/knowledge-reader.agent.ts`
    - `readForCodingTask(owner, repo, organizationId)`: read manifest → check status → if complete, fetch `PROJECT.md`, `ARCHITECTURE.md`, `MODULES.md`, `FILE_INDEX.md` (skip `not_applicable` ones) → return `KnowledgeContext`
    - `readForAnalysisTask(owner, repo, organizationId)`: read manifest → check status → if complete, fetch `PROJECT.md`, `ARCHITECTURE.md`, `MODULES.md`, `API.md`, `BUSINESS_RULES.md` (skip `not_applicable`) → return `KnowledgeContext`
    - If manifest is missing, unparseable, `failed`, or `partial`: log `ActivityLog` WARN entry with message `"Knowledge branch unavailable or incomplete — proceeding without architecture context"` and return `null`
    - Format `promptSection` with header `## Project Architecture Knowledge (ai/architecture)\n\n`
    - _Requirements: 9.1–9.5_

  - [ ]* 10.2 Write property test for agent document selection correctness
    - **Property 11: Agent Document Selection Correctness**
    - **Validates: Requirements 9.2, 9.4**
    - Use `fast-check` with `fc.dictionary(fc.constantFrom(...KNOWLEDGE_DOCUMENTS), fc.constantFrom('complete', 'not_applicable', 'failed'))` to generate status maps; assert `readForCodingTask` selects exactly `{PROJECT.md, ARCHITECTURE.md, MODULES.md, FILE_INDEX.md}` minus `not_applicable` and `readForAnalysisTask` selects exactly `{PROJECT.md, ARCHITECTURE.md, MODULES.md, API.md, BUSINESS_RULES.md}` minus `not_applicable`

  - [x] 10.3 Register `KnowledgeReaderAgent` in `src/ai/ai.module.ts`
    - Add to providers and exports so CodingAgent and AnalysisAgent can inject it
    - _Requirements: 9.1_

- [x] 11. Integrate KnowledgeReaderAgent into CodingAgent and AnalysisAgent
  - [x] 11.1 Modify `src/ai/agents/coding.agent.ts` to accept and prepend knowledge context
    - Add optional `knowledgeContext: KnowledgeContext | null` parameter to `implementStep()` (or add a dedicated `buildContextPrefix()` helper)
    - When `knowledgeContext` is non-null, prepend `knowledgeContext.promptSection` to the user prompt before any source file content
    - _Requirements: 9.2, 9.5_

  - [x] 11.2 Modify `src/ai/agents/analysis.agent.ts` to accept and prepend knowledge context
    - Add optional `knowledgeContext: KnowledgeContext | null` parameter to `analyze()`
    - When `knowledgeContext` is non-null, prepend `knowledgeContext.promptSection` before the project context section
    - _Requirements: 9.2, 9.5_

  - [x] 11.3 Modify `src/queue/workers/ai-coding.worker.ts` to call `KnowledgeReaderAgent` before `CodingAgent`
    - Inject `KnowledgeReaderAgent`
    - Before calling `codingAgent.implementStep()`, call `knowledgeReaderAgent.readForCodingTask(owner, repo, organizationId)`
    - Pass result to `implementStep()` as `knowledgeContext`
    - _Requirements: 9.1, 9.2_

  - [x] 11.4 Modify `src/queue/workers/ai-analysis.worker.ts` to call `KnowledgeReaderAgent` before `AnalysisAgent`
    - Inject `KnowledgeReaderAgent`
    - Before calling `analysisAgent.analyze()`, call `knowledgeReaderAgent.readForAnalysisTask(owner, repo, organizationId)`
    - Pass result to `analyze()` as `knowledgeContext`
    - _Requirements: 9.1, 9.2_

- [x] 12. Checkpoint — backend integration complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. AI_Manifest schema validation
  - [x] 13.1 Create `validateManifest()` utility in `knowledge.types.ts`
    - Validate `schemaVersion ≥ 1`, `status` in enum set, `sourceCommit` is 40-char hex SHA, `analyzedAt` is valid ISO 8601, each document entry has valid `status` and `lastUpdatedCommit`
    - Used by `KnowledgeReaderAgent` and `KnowledgeAnalysisWorker` before trusting manifest data
    - _Requirements: 1.3_

  - [ ]* 13.2 Write property test for AI_Manifest schema conformance
    - **Property 2: AI_Manifest Schema Conformance**
    - **Validates: Requirements 1.3**
    - Use `fast-check` to generate valid and invalid manifests; assert `validateManifest()` returns true only when all fields conform to the specified schema (valid SHA, ISO 8601, enum values, `schemaVersion ≥ 1`)

- [x] 14. Frontend — knowledge API layer and types
  - [x] 14.1 Create `src/lib/api/knowledge.api.ts` in the frontend (`webwow-fe`)
    - Export `KnowledgeDocumentStatus`, `KnowledgeAnalysisStatus` types
    - Export `KnowledgeStatusResponse` interface
    - Export `knowledgeApi` object with `analyze()`, `forceAnalyze()`, `getStatus()` methods following the same `apiClient` pattern as other API files
    - _Requirements: 10.1–10.3, 11.1–11.7_

  - [x] 14.2 Extend `src/types/api.types.ts` with `KnowledgeStatus` types (if the file needs it)
    - Add any shared Knowledge types needed across the frontend
    - _Requirements: 11.1_

- [x] 15. Frontend — Architecture page rewrite
  - [x] 15.1 Rewrite `src/app/(app)/projects/[projectId]/architecture/page.tsx`
    - Replace the `useEffect`/`useState` pattern with TanStack Query `useQuery` for `getStatus`
    - `refetchInterval`: return `3000` when `analysisStatus === 'RUNNING'`, else `false` — polling stops automatically on terminal state
    - Progress steps: render 6 ordered steps ("Kiểm tra repository...", "Đọc AI manifest...", "Phát hiện thay đổi...", "Phân tích với AI...", "Cập nhật tài liệu...", "Hoàn tất") with active/completed/pending styling based on `analysisStatus`
    - Document status grid: for each of the 10 Knowledge Documents, show green checkmark (`complete`), grey circle (`not_applicable`), or red error icon (`failed` / absent)
    - Up-to-date banner: when `analysisStatus === 'COMPLETE'` and `alreadyUpToDate === true`, show "Kiến trúc dự án đã được cập nhật. Không cần gọi AI." in place of progress steps
    - Results panel: `lastAnalyzedCommit` truncated to 7 chars, `lastAnalyzedAt` as `toLocaleString('vi-VN')`, knowledge branch name `ai/architecture`
    - "Phân tích lại" button → calls `knowledgeApi.analyze()`; "Phân tích lại toàn bộ" button → calls `knowledgeApi.forceAnalyze()`; both disabled with spinner while `RUNNING`
    - Error state: display `lastErrorMessage` or fallback "Phân tích thất bại. Vui lòng thử lại." when `FAILED`
    - _Requirements: 11.1–11.7_

  - [ ]* 15.2 Write unit tests for Architecture page polling and status display logic
    - Test that `refetchInterval` returns 3000 when RUNNING and false on terminal states
    - Test button disabled state during RUNNING
    - Test document status icon rendering (checkmark, grey, red) for each `DocumentStatus` value
    - Test `alreadyUpToDate` banner renders correctly
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

- [x] 16. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The design document has 12 Correctness Properties; each property-based test task references its property number and validates the stated requirements
- Property-based tests use `fast-check` (already in the TypeScript/NestJS ecosystem with Jest)
- `maskSecrets()` logic can be extracted from `project-analysis.worker.ts` into `knowledge.types.ts` to avoid duplication
- The `ai/architecture` branch uses the slash separator — ensure GithubService calls use `refs/heads/ai/architecture` as the ref string (slash in branch name is URL-encoded for API calls)
- Frontend polling uses TanStack Query's `refetchInterval` function form (not a static number) so it stops automatically on terminal states

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["5.1", "6.7", "13.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "13.2"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "7.1", "8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "10.1"] },
    { "id": 7, "tasks": ["10.2", "10.3", "11.1", "11.2"] },
    { "id": 8, "tasks": ["11.3", "11.4", "14.1", "14.2"] },
    { "id": 9, "tasks": ["15.1"] },
    { "id": 10, "tasks": ["15.2"] }
  ]
}
```
