# Implementation Plan: AI IT Team SaaS MVP

## Overview

Triển khai toàn bộ MVP từ hai workspace rỗng: backend NestJS (TypeScript, PostgreSQL, Prisma, Redis/BullMQ) và frontend Next.js 14. Kế hoạch chia thành 6 sprint theo thiết kế, mỗi sprint xây dựng trên sprint trước. Ngôn ngữ triển khai: **TypeScript** (strict mode) cho cả hai workspace.

---

## Tasks

### Sprint 1: Foundation — NestJS Setup, Prisma, Auth, Organizations

- [x] 1. Khởi tạo dự án Backend NestJS
  - [x] 1.1 Tạo cấu trúc thư mục NestJS monorepo và cài đặt dependencies
    - Khởi tạo NestJS project với `nest new webwow-be`, bật TypeScript strict mode (`"strict": true` trong `tsconfig.json`)
    - Cài đặt: `@nestjs/config`, `@nestjs/passport`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `helmet`, `express-rate-limit`
    - Tạo cấu trúc thư mục: `src/config/`, `src/common/`, `src/modules/`, `src/ai/`, `src/sandbox/`, `src/queue/`, `src/prisma/`
    - Tạo file `src/main.ts` với global pipes (ValidationPipe), Swagger setup tại `/api/docs`, CORS, Helmet
    - _Requirements: R23.1, R23.2, R23.4, R25.1, R25.2_

  - [x] 1.2 Cài đặt Prisma ORM và định nghĩa database schema
    - Cài đặt `prisma`, `@prisma/client`; chạy `npx prisma init`
    - Viết toàn bộ `prisma/schema.prisma` với 14 models: User, RefreshToken, Organization, OrganizationMember, Project, ProjectAnalysis, GitHubInstallation, Issue, CostEstimate, AITask, AITaskStep, PullRequest, ActivityLog, Usage
    - Định nghĩa đầy đủ enums: OrgRole, ProjectStatus, CompatibilityTier, IssueType, IssuePriority, IssueStatus, AITaskStatus, ComplexityLevel, PullRequestStatus, ActivityEventType
    - Thêm tất cả indexes theo thiết kế (organizationId, projectId, issueId, status, createdAt)
    - Tạo `src/prisma/prisma.module.ts` và `src/prisma/prisma.service.ts`
    - _Requirements: R24.1, R24.2, R24.3, R24.4, R24.5, R24.6_

  - [x] 1.3 Tạo config modules và biến môi trường
    - Tạo 7 config files trong `src/config/`: `app.config.ts`, `database.config.ts`, `jwt.config.ts`, `ai.config.ts`, `github.config.ts`, `redis.config.ts`, `email.config.ts`
    - Mỗi config dùng `@nestjs/config` với `Joi` hoặc `zod` để validate env vars tại startup
    - Tạo `.env.example` với tất cả biến môi trường cần thiết (không hard-code giá trị)
    - _Requirements: R25.3_

  - [ ]* 1.4 Viết unit tests cho PrismaService và config validation
    - Test PrismaService kết nối và onModuleInit/onModuleDestroy
    - Test config validation throws khi thiếu required env vars
    - _Requirements: R24.1, R25.3_

- [x] 2. Triển khai Common Layer (Guards, Filters, Interceptors, Pipes)
  - [x] 2.1 Tạo GlobalExceptionFilter — không để lộ thông tin kỹ thuật nội bộ
    - Viết `src/common/filters/global-exception.filter.ts` bắt mọi exception
    - Map HTTP status codes sang Vietnamese friendly messages theo thiết kế
    - Log đầy đủ stack trace + context vào internal logger, KHÔNG trả về cho client
    - Trả về generic 500 message cho unexpected errors
    - Đăng ký globally trong `main.ts`
    - _Requirements: R20.1, R20.3_

  - [ ]* 2.2 Viết property test cho GlobalExceptionFilter (Property 14)
    - **Property 14: Error Response Không Chứa Thông Tin Kỹ Thuật Nội Bộ**
    - Dùng `fast-check` generate random exceptions (Error, HttpException với các status), assert response body không chứa stack trace, SQL errors, file paths, table names
    - **Validates: Requirements R20.1**

  - [x] 2.3 Tạo JWT Auth Guard, Roles Guard, decorators và interceptors
    - Viết `src/common/guards/jwt-auth.guard.ts` extend `AuthGuard('jwt')`
    - Viết `src/common/guards/roles.guard.ts` kiểm tra OrgRole từ request context
    - Viết `src/common/decorators/current-user.decorator.ts` và `src/common/decorators/org-id.decorator.ts`
    - Viết `src/common/interceptors/logging.interceptor.ts` log mọi request/response
    - Viết `src/common/interceptors/transform-response.interceptor.ts` wrap response
    - Viết `src/common/pipes/validation.pipe.ts` (whitelist: true, transform: true)
    - Tạo `src/common/types/jwt-payload.type.ts` và `src/common/types/pagination.type.ts`
    - _Requirements: R22.1, R23.2, R23.3, R25.2_

  - [ ]* 2.4 Viết unit tests cho Guards và Interceptors
    - Test JwtAuthGuard với valid/invalid/expired tokens
    - Test RolesGuard với các role combinations
    - _Requirements: R22.1_

- [x] 3. Triển khai Auth Module (Đăng ký, Đăng nhập, JWT, OAuth GitHub)
  - [x] 3.1 Tạo Auth DTOs, strategies và cấu trúc module
    - Tạo `src/modules/auth/auth.module.ts` import PassportModule, JwtModule, PrismaModule
    - Viết DTOs: `register.dto.ts` (email RFC5321, password ≥8 chars), `login.dto.ts`, `refresh-token.dto.ts` — dùng class-validator decorators
    - Viết `src/modules/auth/strategies/jwt.strategy.ts` (validate sub + email)
    - Viết `src/modules/auth/strategies/jwt-refresh.strategy.ts`
    - Viết `src/modules/auth/strategies/github-oauth.strategy.ts`
    - _Requirements: R1.1, R1.7, R23.2_

  - [x] 3.2 Triển khai AuthService với bcrypt, JWT và account lockout
    - Viết `src/modules/auth/auth.service.ts` với methods: `register`, `login`, `refresh`, `logout`, `verifyEmail`, `forgotPassword`, `resetPassword`
    - Implement bcrypt với cost factor 12 cho password hashing
    - Implement account lockout: sau 5 lần thất bại liên tiếp → khóa 15 phút, ghi log
    - Implement JWT access token (15 phút) và refresh token (7 ngày) với rotation
    - Implement email verification token và password reset token (1 giờ)
    - Revoke refresh token khi logout (set `revokedAt`)
    - Không để business logic trong controller
    - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.8, R1.9, R25.2_

  - [ ]* 3.3 Viết property tests cho Auth (Properties 1, 2, 3, 4)
    - **Property 1: Xác Thực Định Dạng Email và Mật Khẩu**
    - Dùng `fast-check` generate arbitrary strings, test `validateEmail` và `validatePassword` cho mọi input
    - **Validates: Requirements R1.1**
    - **Property 2: JWT Encode/Decode Round-Trip**
    - Generate arbitrary `{sub, email}` payloads, encode → decode, assert payload tương đương; test expired/wrong-key tokens
    - **Validates: Requirements R1.3, R1.4**
    - **Property 3: Khóa Tài Khoản Sau N Lần Thất Bại**
    - Generate N ≥ 5 và N < 5, assert lockout behavior đúng
    - **Validates: Requirements R1.5**
    - **Property 4: Bcrypt Password Hash Round-Trip**
    - Generate arbitrary passwords, assert hash ≠ plaintext, verify round-trip, assert hai lần hash khác nhau
    - **Validates: Requirements R1.9**

  - [x] 3.4 Viết AuthController với 9 endpoints
    - Viết `src/modules/auth/auth.controller.ts`: POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, GET `/auth/github`, `/auth/github/callback`, POST `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`
    - Chỉ gọi AuthService, không có business logic trong controller
    - Thêm Swagger decorators (`@ApiOperation`, `@ApiResponse`) cho mọi endpoint
    - Apply throttler cho login endpoint (chống brute force)
    - _Requirements: R1.1–R1.9, R23.1, R23.3, R23.4_

  - [ ]* 3.5 Viết unit tests cho AuthService
    - Test register (happy path + duplicate email), login (success, wrong password, locked), refresh, logout
    - Mock PrismaService và NotificationService
    - _Requirements: R1.1–R1.9_

- [x] 4. Triển khai Organizations Module (Multi-Tenant)
  - [x] 4.1 Tạo Organizations DTOs, module và service
    - Tạo `src/modules/organizations/organizations.module.ts`
    - Viết DTOs: `create-organization.dto.ts` (name, slug), `invite-member.dto.ts` (email, role), `update-member-role.dto.ts`
    - Viết `src/modules/organizations/organizations.service.ts` với: `create` (gán OWNER), `findAll` (theo userId), `findById`, `update`, `softDelete` (set deletedAt), `inviteMember` (token 48h), `acceptInvite`, `removeMember`, `updateMemberRole`
    - Mọi query PHẢI bao gồm điều kiện `organizationId` — không trả dữ liệu của org khác
    - Ghi ActivityLog cho mọi thay đổi thành viên
    - _Requirements: R2.1–R2.8, R22.3_

  - [ ]* 4.2 Viết property test cho Multi-Tenant Data Isolation (Property 5)
    - **Property 5: Multi-Tenant Data Isolation**
    - Generate arbitrary (orgA, orgB, userId), assert rằng khi query với orgA không bao giờ trả về resource của orgB
    - Assert truy cập resource orgB → 403 hoặc 404
    - **Validates: Requirements R2.5, R2.6, R22.3**

  - [x] 4.3 Viết Organizations và Members Controllers
    - Viết `src/modules/organizations/organizations.controller.ts`: 5 endpoints (CRUD + soft delete)
    - Viết `src/modules/organizations/members.controller.ts`: 4 endpoints (invite, list, update role, remove)
    - Apply JwtAuthGuard và RolesGuard theo role hierarchy (OWNER > ADMIN > MEMBER)
    - Return 403 Forbidden cho truy cập không đúng role, không tiết lộ org info của org khác
    - _Requirements: R2.2, R2.5, R22.1, R22.2, R23.1, R23.3_

  - [ ]* 4.4 Viết unit tests cho OrganizationsService
    - Test create, findById với wrong orgId (expect 404), inviteMember, acceptInvite (expired token)
    - _Requirements: R2.1–R2.7_

- [x] 5. Checkpoint Sprint 1 — Đảm bảo tất cả tests pass
  - Chạy `npm test` — toàn bộ unit tests và property tests Sprint 1 phải pass
  - Verify Swagger UI accessible tại `/api/docs`
  - Hỏi người dùng nếu có câu hỏi trước khi tiếp tục Sprint 2.

---

### Sprint 2: GitHub Integration và Projects Module

- [x] 6. Triển khai GitHub Integration Module
  - [x] 6.1 Tạo Octokit provider và GitHub App authentication
    - Cài đặt `@octokit/rest`, `@octokit/auth-app`
    - Viết `src/modules/github/octokit.provider.ts` — GitHub App JWT authentication (không dùng PAT)
    - Viết utility `encryptToken` / `decryptToken` dùng AES-256-GCM trong `github.service.ts`
    - GitHubInstallation token được mã hóa trước khi lưu DB
    - _Requirements: R3.1, R3.2, R3.3, R22.5_

  - [x] 6.2 Triển khai GitHubService và GitHub webhook controller
    - Viết `src/modules/github/github.service.ts`: `getInstallUrl`, `handleCallback` (lưu encrypted token), `getRepositories`, `getBranches`, `createBranch`, `commitFiles`, `createPullRequest`, `syncPRStatus`
    - Liệt kê repos trong vòng 5 giây (R3.4) — sử dụng pagination nếu cần
    - Viết `src/modules/github/github-webhook.controller.ts` verify GitHub webhook signature
    - _Requirements: R3.2, R3.4, R13.4_

  - [x] 6.3 Viết GitHubController với 5 endpoints
    - Viết `src/modules/github/github.controller.ts`: GET `/github/install-url`, `/github/callback`, `/github/repos`, `/github/repos/:owner/:repo/branches`, POST `/github/webhook`
    - _Requirements: R3.1, R3.4, R13.4, R23.1_

  - [ ]* 6.4 Viết unit tests cho GitHubService
    - Test encryptToken / decryptToken round-trip
    - Test createPullRequest với mock Octokit
    - Test webhook signature verification (valid + invalid)
    - _Requirements: R3.1, R3.3, R13.1_

- [x] 7. Triển khai Projects Module và CompatibilityScorer
  - [x] 7.1 Tạo Projects DTOs, module và ProjectsService
    - Tạo `src/modules/projects/projects.module.ts`
    - Viết DTOs: `create-project.dto.ts` (githubRepoFullName, githubInstallationId, defaultBranch), `update-project.dto.ts`
    - Viết `src/modules/projects/projects.service.ts`: `create` (tạo Project với status PENDING_ANALYSIS, enqueue PROJECT_ANALYSIS job), `findAll` (theo organizationId), `findById`, `update`, `softDelete`, `reanalyze` (chỉ khi không có AITask đang chạy)
    - Mọi query PHẢI filter theo `organizationId`
    - _Requirements: R3.5, R3.7, R15.3, R15.4, R22.3_

  - [x] 7.2 Triển khai CompatibilityScorerService
    - Viết `src/modules/projects/compatibility-scorer.service.ts`
    - Method `calculate(analysis)` → trả về score (0–100) dựa trên: ngôn ngữ/framework hỗ trợ, có tests, chất lượng config, độ phức tạp codebase
    - Method `classifyTier(score)` → phân loại: [90-100] FULL_AI_SUPPORT, [70-89] AI_ASSISTED, [40-69] LIMITED_SUPPORT, [0-39] UNSUPPORTED
    - Tạo danh sách `compatibilityNotes` bằng ngôn ngữ thân thiện với khách hàng
    - Hiển thị cảnh báo khi score < 40
    - _Requirements: R5.1–R5.5_

  - [ ]* 7.3 Viết property tests cho CompatibilityScorer (Property 6)
    - **Property 6: Compatibility Score trong Khoảng [0, 100] và Phân Loại Đúng**
    - Generate arbitrary ProjectAnalysis inputs, assert score ∈ [0, 100] (integer)
    - Generate arbitrary scores (0–100), assert tier classification đúng boundary và mutually exclusive
    - **Validates: Requirements R5.1, R5.2**

  - [x] 7.4 Viết ProjectsController và kết nối Queue Module
    - Viết `src/modules/projects/projects.controller.ts`: 7 endpoints (CRUD + analysis + reanalyze)
    - Tích hợp QueueModule để enqueue PROJECT_ANALYSIS jobs
    - _Requirements: R3.5, R15.3, R15.4, R23.1_

  - [ ]* 7.5 Viết unit tests cho ProjectsService
    - Test create (enqueue job), findById wrong org (expect 404), reanalyze khi có AITask running (expect error)
    - _Requirements: R3.5, R15.4_

- [x] 8. Triển khai Queue Module và ProjectAnalysis Worker
  - [x] 8.1 Tạo Queue Module với BullMQ và Redis
    - Cài đặt `bullmq`, `@nestjs/bullmq`, `ioredis`
    - Tạo `src/queue/queue.module.ts` cấu hình BullMQ với Redis
    - Tạo `src/queue/queue.constants.ts` định nghĩa QUEUES và CONCURRENCY constants
    - Cấu hình exponential backoff: lần 1 → 30s, lần 2 → 120s, lần 3 → 600s; tối đa 3 attempts
    - AI_CODING queue: max concurrency 5
    - _Requirements: R19.1, R19.2, R19.3, R19.4, R19.5_

  - [ ]* 8.2 Viết property test cho Queue Retry (Property 16)
    - **Property 16: Queue Retry Delay Theo Exponential Backoff**
    - Generate N ∈ {1, 2, 3}, assert delay = {30s, 120s, 600s} tương ứng
    - Assert sau 3 lần fail không retry thêm
    - **Validates: Requirements R19.3**

  - [x] 8.3 Triển khai ProjectAnalysisWorker
    - Viết `src/queue/workers/project-analysis.worker.ts` xử lý PROJECT_ANALYSIS jobs
    - Step 1: Decrypt GitHub token, clone repo via Octokit
    - Step 2: Đọc config files (package.json, tsconfig, Dockerfile, .github/workflows, README)
    - Step 3: Detect frameworks, languages, databases, build tools
    - Step 4: Mask secrets (entropy-based detection — không đọc giá trị secrets)
    - Step 5: Gọi CompatibilityScorerService → tính score
    - Step 6: Persist ProjectAnalysis record
    - Step 7: Update Project status → ACTIVE
    - Step 8: Gửi notification tới OWNER
    - Error handler: Update Project → ANALYSIS_FAILED, gửi notification
    - Hoàn thành trong 10 phút cho repo < 500MB (R4.7)
    - _Requirements: R4.1–R4.7, R5.1–R5.3_

  - [ ]* 8.4 Viết unit tests cho ProjectAnalysisWorker
    - Test với mock GitHub API, assert ProjectAnalysis record được tạo đúng
    - Test error path (GitHub auth fail) → ANALYSIS_FAILED
    - Test secret masking (input có API key → output không chứa key)
    - _Requirements: R4.1–R4.6_

- [x] 9. Checkpoint Sprint 2 — Đảm bảo tất cả tests pass
  - Chạy `npm test` — toàn bộ unit tests và property tests Sprint 1 + 2 phải pass
  - Verify GitHub App integration endpoints hoạt động với Swagger
  - Hỏi người dùng nếu có câu hỏi trước khi tiếp tục Sprint 3.

---

### Sprint 3: AI Core — AIProvider, Agents, Prompts, Pricing, Issues

- [x] 10. Triển khai AI Provider Layer
  - [x] 10.1 Định nghĩa IAIProvider interface và triển khai OpenAI/Anthropic providers
    - Viết `src/ai/providers/ai-provider.interface.ts`: interface `IAIProvider` với `call<T>(systemPrompt, userPrompt, options?)` và `getProviderName()`
    - Viết `src/ai/providers/openai.provider.ts` implement `IAIProvider` — dùng OpenAI SDK, ghi token usage vào ActivityLog
    - Viết `src/ai/providers/anthropic.provider.ts` implement `IAIProvider` — dùng Anthropic SDK
    - Factory/dynamic module chọn provider qua `AI_PROVIDER` env var (không cần đổi code)
    - Implement exponential backoff cho rate limit (429): max 3 retries
    - _Requirements: R21.1, R21.2, R21.3, R21.5, R25.5_

  - [x] 10.2 Định nghĩa Zod schemas cho AI responses
    - Viết `src/ai/schemas/implementation-plan.schema.ts`: `ImplementationStepSchema`, `ImplementationPlanSchema` (Zod)
    - Viết `src/ai/schemas/analysis-result.schema.ts`: `AnalysisResultSchema`
    - Viết `src/ai/schemas/review-result.schema.ts`
    - Mọi AI response PHẢI pass schema validation trước khi lưu DB
    - _Requirements: R7.4, R7.9, R21.4_

  - [ ]* 10.3 Viết property test cho ImplementationPlan Schema Validation (Property 13)
    - **Property 13: ImplementationPlan Schema Validation Round-Trip**
    - Generate arbitrary JSON objects, nếu pass `ImplementationPlanSchema.parse()` thì serialize + parse lần 2 → kết quả tương đương
    - Generate invalid objects, assert throws `ZodError` ngay lập tức
    - **Validates: Requirements R7.4, R21.4**

  - [ ]* 10.4 Viết unit tests cho AIProvider implementations
    - Test OpenAI provider gọi API đúng, ghi ActivityLog token usage
    - Test retry logic khi 429 rate limit (mock 2 lần 429 rồi success)
    - Test provider switch qua env var
    - _Requirements: R21.2, R21.3, R21.5_

- [x] 11. Triển khai AI Prompt Classes và Agents
  - [x] 11.1 Tạo Prompt classes (tách biệt khỏi service logic)
    - Viết `src/ai/prompts/project-analysis.prompt.ts`: `ProjectAnalysisPrompt.buildSystem()`, `buildUser()`
    - Viết `src/ai/prompts/issue-analysis.prompt.ts`: `IssueAnalysisPrompt.buildSystem()`, `buildUser(issue, projectContext)`
    - Viết `src/ai/prompts/planning.prompt.ts`: `PlanningPrompt.buildSystem()`, `buildUser(issue, analysis, context)`
    - Viết `src/ai/prompts/coding.prompt.ts`: `CodingPrompt` cho từng bước coding
    - Viết `src/ai/prompts/review.prompt.ts`: `ReviewPrompt` cho code review
    - CRITICAL instructions trong mọi prompt: chỉ reference files đã tồn tại, KHÔNG bịa đặt
    - _Requirements: R7.5, R25.4_

  - [x] 11.2 Triển khai AIAnalysisAgent và PlanningAgent
    - Viết `src/ai/agents/analysis.agent.ts`: `AIAnalysisAgent.analyze(issue, projectContext)` — gọi `IssueAnalysisPrompt`, validate với `AnalysisResultSchema`
    - Viết `src/ai/agents/planning.agent.ts`: `PlanningAgent.plan(issue, analysisResult, context)` — gọi `PlanningPrompt`, validate với `ImplementationPlanSchema`
    - Hoàn thành trong 120 giây cho LOW/MEDIUM complexity (R7.8)
    - _Requirements: R7.1–R7.9_

  - [x] 11.3 Triển khai CodingAgent (logic layer — không có sandbox)
    - Viết `src/ai/agents/coding.agent.ts`: nhận `ImplementationPlan`, generate code changes cho từng step
    - Chỉ tạo/sửa/xóa files được listed trong `plan.steps` (enforce whitelist)
    - Gọi `CodingPrompt` cho từng file modification
    - _Requirements: R11.2, R7.5_

  - [x] 11.4 Triển khai ReviewAgent
    - Viết `src/ai/agents/review.agent.ts`: nhận code diff + test results, tạo review summary
    - Dùng `ReviewPrompt`
    - _Requirements: R11.3_

  - [ ]* 11.5 Viết unit tests cho AI Agents
    - Test AIAnalysisAgent với mock IAIProvider, assert AnalysisResult valid schema
    - Test PlanningAgent, assert ImplementationPlan valid schema
    - Test CodingAgent whitelist enforcement (plan có 3 files → chỉ 3 files được touched)
    - _Requirements: R7.2, R7.5, R11.2_

- [x] 12. Triển khai PricingService, Issues Module và AIAnalysis Worker
  - [x] 12.1 Triển khai PricingService
    - Viết `src/modules/pricing/pricing.service.ts`: method `calculate(input: PricingInput): CostEstimateData`
    - Tính `internalAiCost` dựa trên token count × complexity multiplier
    - Tính `customerPriceBase` = `internalCost × 2.5` (PRICE_MARGIN)
    - Tính min/max với ±20% variance
    - Tính `developerComparison` dựa trên complexity (LOW→$150, MEDIUM→$450, HIGH→$1200, CRITICAL→$3000)
    - Set `expiresAt` = 24 giờ từ khi tạo
    - `internalAiCost` KHÔNG BAO GIỜ xuất hiện trong response API customer
    - _Requirements: R8.1–R8.4_

  - [ ]* 12.2 Viết property tests cho PricingService (Property 7)
    - **Property 7: Customer Price Luôn ≥ Internal AI Cost (Margin Dương)**
    - Generate arbitrary `PricingInput`, assert `customerPriceBase > internalAiCost`
    - Assert variance: `customerPriceMax - customerPriceMin ≈ 0.4 × customerPriceBase`
    - Assert `internalAiCost` không xuất hiện trong serialized response DTO
    - **Validates: Requirements R8.2, R8.3**

  - [x] 12.3 Tạo Issues Module, DTOs và IssueService
    - Tạo `src/modules/issues/issues.module.ts`
    - Viết DTOs: `create-issue.dto.ts` (title, description min 10/max 5000 chars, type, priority), `update-issue.dto.ts`
    - Viết `src/modules/issues/issues.service.ts`: `create` (đặt status ANALYZING, enqueue AI_ANALYSIS), `findAll`, `findById`, `update`, `softDelete`
    - Reject tạo Issue nếu Project compatibility score < 40 (UNSUPPORTED) — trả về thông báo thân thiện
    - Rate limiting: 20 Issues/ngày/Organization
    - Apply `@Throttle({ default: { limit: 10, ttl: 60000 } })` cho tạo Issue (R23.5)
    - _Requirements: R6.1–R6.6, R23.5_

  - [ ]* 12.4 Viết property test cho Issue Description Validation (Property 15)
    - **Property 15: Issue Description Validation**
    - Generate arbitrary strings, assert `create()` thành công ⟺ `10 <= description.trim().length <= 5000`
    - Assert descriptions < 10 chars → 400 error
    - **Validates: Requirements R6.1**

  - [x] 12.5 Triển khai AIAnalysisWorker
    - Viết `src/queue/workers/ai-analysis.worker.ts` xử lý AI_ANALYSIS jobs
    - Step 1: Load ProjectContextProvider (ProjectAnalysis từ DB)
    - Step 2: Gọi AIAnalysisAgent.analyze() → validate với AnalysisResultSchema
    - Step 3: Gọi PlanningAgent.plan() → validate với ImplementationPlanSchema
    - Step 4: Gọi PricingService.calculate() → tạo CostEstimate
    - Step 5: Persist analysis + ImplementationPlan + CostEstimate vào Issue
    - Step 6: Update Issue status → PLAN_READY
    - Step 7: Gửi notification tới customer
    - Error: sau 3 retries → Issue status → ANALYSIS_FAILED, ghi ActivityLog
    - _Requirements: R7.1–R7.9, R8.1–R8.4_

  - [ ]* 12.6 Viết unit tests cho IssueService và AIAnalysisWorker
    - Test IssueService.create với UNSUPPORTED project (expect error)
    - Test AIAnalysisWorker với mock AIProvider — assert ImplementationPlan persisted
    - Test 3-retry exhaustion → ANALYSIS_FAILED
    - _Requirements: R6.5, R7.7_

  - [x] 12.7 Viết IssuesController với 5 endpoints
    - Viết `src/modules/issues/issues.controller.ts`: POST/GET/GET/:id/PATCH/DELETE theo route `/projects/:projectId/issues`
    - Apply JwtAuthGuard, validate projectId ownership
    - _Requirements: R6.1, R23.1, R23.3_

- [x] 13. Triển khai Notifications Module và Activity Module
  - [x] 13.1 Tạo NotificationsService và ActivityService
    - Viết `src/modules/notifications/notifications.service.ts`: `sendEmail(to, subject, body)` — wrap email provider (Resend/SMTP) sau interface
    - Viết `src/modules/activity/activity.service.ts`: `log(entry: CreateActivityLogDto)` — đảm bảo mọi log có `organizationId`, `eventType`, `friendlyMessage`, `createdAt`
    - Viết `src/modules/activity/activity.controller.ts`: GET `/activity` (org-scoped) và GET `/activity/:taskId`
    - _Requirements: R17.1, R17.3, R17.4_

  - [ ]* 13.2 Viết property test cho ActivityLog Metadata (Property 11)
    - **Property 11: ActivityLog Luôn Có Đủ Required Metadata**
    - Generate arbitrary ActivityLog creation calls, assert `organizationId`, `eventType`, `friendlyMessage`, `createdAt` luôn không null
    - Generate AITask log entries, assert `taskId` và `projectId` luôn present
    - **Validates: Requirements R17.3**

  - [ ]* 13.3 Viết unit tests cho NotificationsService và ActivityService
    - Test `log()` với missing required fields → throw validation error
    - Test email notification với mock email provider
    - _Requirements: R17.3_

- [x] 14. Checkpoint Sprint 3 — Đảm bảo tất cả tests pass
  - Chạy `npm test` — toàn bộ unit tests và property tests Sprint 1–3 phải pass
  - Verify AI Provider switch hoạt động qua env var
  - Hỏi người dùng nếu có câu hỏi trước khi tiếp tục Sprint 4.

---

### Sprint 4: Approval Flow, AITask State Machine, CodingAgent, Sandbox, PR Creation

- [x] 15. Triển khai AITask State Machine và Approvals Module
  - [x] 15.1 Triển khai StateMachineService
    - Viết `src/modules/ai-tasks/state-machine.service.ts` với `VALID_TRANSITIONS` map (14 trạng thái theo thiết kế)
    - Method `transition(task, toStatus)`: kiểm tra `toStatus ∈ VALID_TRANSITIONS[fromStatus]`, nếu không hợp lệ → throw `BadRequestException`, KHÔNG thay đổi DB
    - Method `canTransitionTo(fromStatus, toStatus)` trả về boolean
    - _Requirements: R10.1, R10.3_

  - [ ]* 15.2 Viết property test cho AITask State Machine (Property 8)
    - **Property 8: AITask State Machine Không Bỏ Qua Trạng Thái**
    - Generate arbitrary `(fromStatus, toStatus)` pairs từ tất cả AITaskStatus values
    - Assert `transition()` thành công ⟺ `toStatus ∈ VALID_TRANSITIONS[fromStatus]`
    - Assert invalid transitions throw exception và không modify DB
    - **Validates: Requirements R10.1, R10.3**

  - [x] 15.3 Triển khai AITasksModule, AITasksService và AITasksController
    - Tạo `src/modules/ai-tasks/ai-tasks.module.ts`
    - Viết `src/modules/ai-tasks/ai-tasks.service.ts`: `findAll` (org-scoped), `findById`, `cancel`, `getLogs`
    - Mọi status change PHẢI đi qua StateMachineService + ghi ActivityLog
    - Khi AITask → FAILED: hiển thị customer-friendly message từ `FAILURE_MESSAGES` map, KHÔNG expose stack trace
    - Viết `src/modules/ai-tasks/ai-tasks.controller.ts`: 4 endpoints (list, get, cancel, logs)
    - _Requirements: R10.1–R10.5, R20.1, R20.2_

  - [x] 15.4 Triển khai ApprovalsModule, ApprovalsService và ApprovalsController
    - Tạo `src/modules/approvals/approvals.module.ts`
    - Viết `src/modules/approvals/approvals.service.ts`: `approve(issueId, userId, ipAddress)` — ghi ActivityLog với userId + timestamp + ipAddress, cập nhật Issue → APPROVED, enqueue AITask vào queue
    - Method `reject(issueId, reason)` — cập nhật Issue → REJECTED, lưu `rejectionReason`
    - Implement reminder: gửi email sau 24h và 48h nếu PLAN_READY chưa xử lý
    - Implement re-estimate khi CostEstimate hết hạn
    - AI KHÔNG BAO GIỜ thực hiện thay đổi code trước khi `approve()` được gọi
    - Viết `src/modules/approvals/approvals.controller.ts`: POST `/issues/:issueId/approve` và `/issues/:issueId/reject`
    - _Requirements: R9.1–R9.6_

  - [ ]* 15.5 Viết unit tests cho StateMachineService, AITasksService, ApprovalsService
    - Test tất cả valid transitions (assert success)
    - Test tất cả invalid transitions (assert throw exception, DB unchanged)
    - Test approve() ghi đúng ActivityLog fields (userId, ipAddress, timestamp)
    - _Requirements: R9.1, R9.3, R10.1, R10.3_

- [x] 16. Triển khai Sandbox Executor và Docker sandbox
  - [x] 16.1 Tạo Dockerfile sandbox và cấu hình network isolation
    - Viết `docker/sandbox/Dockerfile`: base image Node.js + Git, không có network access tới internal infrastructure
    - Viết `docker/sandbox/docker-compose.sandbox.yml` với `sandbox-net` network: chỉ cho phép outbound tới github.com và package registries
    - Cấu hình iptables rules block 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    - Resource limits: CPU=2, memory=4g, disk=10g, timeout=30min
    - _Requirements: R12.1, R12.2_

  - [x] 16.2 Triển khai SandboxExecutorService
    - Viết `src/sandbox/sandbox-executor.service.ts` và `src/sandbox/sandbox.types.ts`
    - Method `create(config)`: `docker run` với resource limits và isolated network, trả về containerId
    - Method `exec(containerId, command)`: `docker exec` với timeout enforcement, log mọi command/stdout/stderr/exitCode/duration vào ActivityLog
    - Method `destroy(containerId)`: `docker stop && docker rm`, xóa workspace volume hoàn toàn
    - Detect resource limit breach → kill container ngay, ghi log, chuyển AITask → FAILED
    - Audit log (command + files read/write) KHÔNG thể bị xóa bởi AI agents
    - _Requirements: R12.1–R12.6_

  - [ ]* 16.3 Viết unit tests cho SandboxExecutorService
    - Test create trả về containerId
    - Test exec log đúng CommandResult
    - Test destroy cleanup workspace
    - Test resource limit → FAILED transition
    - _Requirements: R12.1, R12.4, R12.5, R12.6_

- [x] 17. Triển khai AICodingWorker, PRCreationWorker và Usage/Billing
  - [x] 17.1 Triển khai AICodingWorker (full execution pipeline)
    - Viết `src/queue/workers/ai-coding.worker.ts`
    - Step 1: Update AITask → PREPARING, tạo Docker sandbox via SandboxExecutorService
    - Step 2: Clone repo, tạo branch `ai/{issueId}-{slug}` (enforce naming convention regex)
    - Step 3: Update AITask → CODING
    - Step 4: Với mỗi step trong ImplementationPlan: đọc/ghi CHỈ files trong approved list, log mọi file operation
    - Step 5: Update AITask → TESTING, chạy formatter → linter → tests → build trong sandbox
    - Step 6: Nếu fail → FIXING (max 3 attempts: gọi AIProvider để fix, re-run checks)
    - Step 7: Update AITask → REVIEWING, commit với Conventional Commits format, push branch
    - Step 8: Enqueue PR_CREATION job
    - Step 9: Cleanup sandbox (destroy container, xóa workspace)
    - Error → FAILED với customer-friendly message, cleanup sandbox
    - _Requirements: R11.1–R11.7, R12.1–R12.6, R13.2_

  - [ ]* 17.2 Viết property test cho CodingAgent File Whitelist (Property 9)
    - **Property 9: CodingAgent Chỉ Thay Đổi File Trong Approved Plan**
    - Generate arbitrary ImplementationPlan với N files, mock sandbox execution
    - Assert set của files được touched ⊆ `{step.filePath | step ∈ plan.steps}`
    - Assert không file nào ngoài danh sách được tạo/sửa/xóa
    - **Validates: Requirements R11.2**

  - [ ]* 17.3 Viết property test cho Branch Name Convention (Property 10)
    - **Property 10: Branch Name Theo Convention**
    - Generate arbitrary issueIds và titles, assert `generateBranchName()` → khớp regex `/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/`
    - Assert không bao giờ bằng tên default branch
    - **Validates: Requirements R13.2**

  - [x] 17.4 Triển khai PRCreationWorker
    - Viết `src/queue/workers/pr-creation.worker.ts`
    - Gọi GitHubService.createPullRequest() với title thân thiện, mô tả thay đổi, danh sách files, test results, link về Issue
    - Tạo bản ghi PullRequest trong DB
    - Update AITask → COMPLETED
    - Gửi notification với link PR
    - AI KHÔNG merge PR trực tiếp (R11.6)
    - _Requirements: R13.1–R13.3, R11.5, R11.6_

  - [x] 17.5 Triển khai Usage Module và UsageService
    - Tạo `src/modules/usage/usage.module.ts`
    - Viết `src/modules/usage/usage.service.ts`: `incrementUsage(orgId, taskCost)` — upsert Usage record theo org+year+month
    - Method `getCurrentMonthUsage(orgId)`, `getUsageHistory(orgId)`
    - Check usage cap: khi đạt 80% → gửi warning email + banner; khi vượt cap → block tạo Issue mới
    - KHÔNG bao giờ expose `internalCost` cho customer API response
    - _Requirements: R18.1–R18.5_

  - [ ]* 17.6 Viết property test cho Usage Aggregation (Property 12)
    - **Property 12: Usage Aggregation Nhất Quán**
    - Generate arbitrary set of completed AITasks với customerCost values cho một org/month
    - Assert `sum(task.actualCost) === Usage.customerCost` (±0.01 USD tolerance)
    - **Validates: Requirements R18.1**

  - [x] 17.7 Viết UsageController
    - Viết `src/modules/usage/usage.controller.ts`: GET `/usage` và GET `/usage/history`
    - Response KHÔNG chứa `internalCost` field
    - _Requirements: R18.2, R18.3, R23.1_

  - [ ]* 17.8 Viết unit tests cho AICodingWorker, PRCreationWorker và UsageService
    - Test AICodingWorker step flow với mock SandboxExecutor
    - Test FIXING path: 3 lần thử → FAILED
    - Test PRCreationWorker tạo PullRequest record đúng
    - Test UsageService usage cap enforcement
    - _Requirements: R11.4, R13.1, R18.4, R18.5_

- [x] 18. Checkpoint Sprint 4 — Đảm bảo tất cả tests pass
  - Chạy `npm test` — toàn bộ unit tests và property tests Sprint 1–4 phải pass
  - Verify state machine transitions đầy đủ (14 trạng thái)
  - Hỏi người dùng nếu có câu hỏi trước khi tiếp tục Sprint 5 (Frontend).

---

### Sprint 5: Frontend — Next.js 14 App Router, tất cả trang và components

- [x] 19. Khởi tạo dự án Frontend Next.js 14
  - [x] 19.1 Tạo cấu trúc Next.js 14 App Router và cài đặt dependencies
    - Khởi tạo Next.js 14 project với TypeScript strict mode
    - Cài đặt: `shadcn/ui`, `tailwindcss`, `@tanstack/react-query`, `zustand`, `axios`, `react-hook-form`, `zod`
    - Tạo cấu trúc thư mục: `src/app/(auth)/`, `src/app/(app)/`, `src/components/`, `src/lib/api/`, `src/lib/hooks/`, `src/lib/utils/`, `src/stores/`, `src/types/`
    - Tạo `src/app/layout.tsx` (root layout với QueryClientProvider, Toaster)
    - Cấu hình `tailwind.config.ts`, tích hợp shadcn/ui components
    - _Requirements: R25.1_

  - [x] 19.2 Tạo API client, types và stores
    - Viết `src/lib/api/client.ts`: Axios instance với baseURL từ env, interceptors (attach Authorization header, handle 401 → refresh token → retry)
    - Viết `src/types/api.types.ts` và `src/types/models.types.ts` mirror backend DTOs
    - Viết `src/stores/auth.store.ts` (Zustand: user, accessToken, refreshToken, actions)
    - Viết `src/stores/org.store.ts` (Zustand: activeOrganization)
    - Viết `src/lib/api/auth.api.ts`, `projects.api.ts`, `issues.api.ts`, `ai-tasks.api.ts`, `activity.api.ts`, `usage.api.ts`
    - Viết utils: `src/lib/utils/format-currency.ts`, `format-date.ts`, `cn.ts`
    - _Requirements: R23.1, R25.1_

  - [x] 19.3 Tạo Layout components
    - Viết `src/components/layout/sidebar.tsx`: điều hướng tới Dashboard, Projects, Usage & Billing, Settings
    - Viết `src/components/layout/topbar.tsx`: active org selector, user menu
    - Viết `src/components/layout/breadcrumb.tsx`
    - Viết `src/app/(app)/layout.tsx`: app shell với sidebar + topbar (chỉ cho authenticated users)
    - Viết `src/components/common/error-boundary.tsx`, `loading-skeleton.tsx`, `empty-state.tsx`
    - _Requirements: R14.2_

- [x] 20. Triển khai Auth pages và hooks
  - [x] 20.1 Tạo Authentication pages (Login, Register, Verify Email, Forgot Password)
    - Viết `src/app/(auth)/login/page.tsx`: form email/password với validation, link GitHub OAuth
    - Viết `src/app/(auth)/register/page.tsx`: form đăng ký với email, password validation
    - Viết `src/app/(auth)/verify-email/page.tsx`: hiển thị trạng thái xác thực email
    - Viết `src/app/(auth)/forgot-password/page.tsx`: form gửi email reset password
    - Dùng react-hook-form + zod validation; lỗi backend hiển thị friendly (KHÔNG show stack trace)
    - _Requirements: R1.1, R1.2, R1.7, R14.2, R20.1_

  - [x] 20.2 Triển khai Auth hooks và token refresh flow
    - Viết `src/lib/hooks/use-auth.ts`: login, logout, register, hiện tại dùng auth.store
    - Implement token auto-refresh trong Axios interceptor (401 → refresh → retry original request)
    - _Requirements: R1.3, R1.4, R1.8_

- [x] 21. Triển khai Dashboard và Projects pages
  - [x] 21.1 Tạo Dashboard page và components
    - Viết `src/app/(app)/dashboard/page.tsx`
    - Viết `src/components/dashboard/stats-cards.tsx`: total projects, active tasks, pending approvals, monthly cost, success rate
    - Viết `src/components/dashboard/activity-feed.tsx`: 20 sự kiện gần nhất với timestamp và project link
    - Viết `src/components/dashboard/pending-approvals.tsx`: danh sách Issues đang chờ phê duyệt
    - Dữ liệu load trong 2 giây, cache max 5 phút (React Query `staleTime`)
    - _Requirements: R14.1–R14.5_

  - [x] 21.2 Tạo Projects list page và form kết nối repo
    - Viết `src/app/(app)/projects/page.tsx`: danh sách projects với compatibility badge
    - Viết `src/app/(app)/projects/new/page.tsx`: chọn GitHub repo từ dropdown (gọi `/github/repos`), chọn default branch
    - Viết `src/components/projects/project-card.tsx` và `compatibility-badge.tsx`
    - _Requirements: R3.4, R3.5, R3.7, R5.4_

  - [x] 21.3 Tạo Project detail page với 6 tabs
    - Viết `src/app/(app)/projects/[projectId]/page.tsx`: tab router
    - Viết `src/components/projects/project-tabs.tsx` (Overview, Issues, Architecture, AI Tasks, Pull Requests, Activity)
    - Viết tab `src/app/(app)/projects/[projectId]/overview/page.tsx`: trạng thái analysis, last analyzed, nút reanalyze
    - Viết tab `src/app/(app)/projects/[projectId]/architecture/page.tsx`: framework, language, databases, dependencies, modules, test coverage, build status, AI Support Score — ngôn ngữ thân thiện
    - Viết `src/components/projects/architecture-view.tsx`
    - _Requirements: R15.1–R15.4_

- [x] 22. Triển khai Issues pages và Approval panel
  - [x] 22.1 Tạo Issues list page và form tạo Issue
    - Viết `src/app/(app)/projects/[projectId]/issues/page.tsx`: danh sách Issues với status badge, filter theo status
    - Viết `src/app/(app)/projects/[projectId]/issues/new/page.tsx`: form mô tả bằng ngôn ngữ tự nhiên (title, description, type, priority)
    - Viết `src/components/issues/issue-form.tsx`: validation description 10–5000 chars
    - Viết `src/components/issues/issue-card.tsx` và `issue-status-badge.tsx`
    - _Requirements: R6.1–R6.3_

  - [x] 22.2 Tạo Issue detail page với timeline và approval panel
    - Viết `src/app/(app)/projects/[projectId]/issues/[issueId]/page.tsx`
    - Hiển thị: tiêu đề, mô tả gốc, AI diagnosis, affected files, risk level, complexity, implementation plan, cost estimate, customer price
    - Khi Issue COMPLETED/FAILED: hiện thêm files changed, test results, build results, AI review summary, PR link
    - Viết `src/components/issues/implementation-plan-view.tsx`: hiển thị plan bằng ngôn ngữ thân thiện
    - Viết `src/components/issues/cost-estimate-card.tsx`: customer price range, dev comparison, expiry warning (KHÔNG hiện internal cost)
    - Viết `src/components/issues/approval-panel.tsx`: nút Approve/Reject (chỉ hiện khi PLAN_READY), input reason khi reject
    - Viết state timeline (lịch sử chuyển tiếp trạng thái với timestamp và friendly description)
    - _Requirements: R9.2, R16.1–R16.3, R18.3_

  - [x] 22.3 Triển khai live polling cho AITask đang chạy
    - Viết `src/lib/hooks/use-live-task.ts`: polling mỗi 10 giây khi task ở CODING/TESTING/FIXING
    - Tự động dừng polling khi task đạt trạng thái terminal (COMPLETED/FAILED/CANCELLED)
    - Không reload trang khi polling
    - _Requirements: R16.4_

- [x] 23. Triển khai AI Tasks pages và Activity pages
  - [x] 23.1 Tạo AI Tasks list và detail pages
    - Viết `src/app/(app)/projects/[projectId]/ai-tasks/page.tsx`: danh sách AITasks với status badge
    - Viết `src/app/(app)/projects/[projectId]/ai-tasks/[taskId]/page.tsx`
    - Viết `src/components/ai-tasks/task-state-timeline.tsx`: visual progress bar qua 14 trạng thái
    - Viết `src/components/ai-tasks/task-live-status.tsx`: dùng `use-live-task` hook, hiện currentStep
    - Viết `src/components/ai-tasks/activity-log-viewer.tsx`: 2 cấp độ log (friendly ↔ technical toggle)
    - _Requirements: R10.4, R17.1, R17.2, R17.4_

  - [x] 23.2 Tạo Activity page và Pull Requests page
    - Viết `src/app/(app)/projects/[projectId]/activity/page.tsx`: toàn bộ activity log của project với filter theo type/date range
    - Viết `src/app/(app)/projects/[projectId]/pull-requests/page.tsx`: danh sách PRs với status (OPEN/CLOSED/MERGED) và GitHub link
    - _Requirements: R13.3, R13.4, R17.4_

- [x] 24. Triển khai Usage, Settings pages và tích hợp GitHub App install
  - [x] 24.1 Tạo Usage & Billing page
    - Viết `src/app/(app)/usage/page.tsx`
    - Hiển thị: chi phí tháng hiện tại, usage bar, biểu đồ chi phí theo thời gian, breakdown theo project/issue
    - Hiện warning banner khi đạt 80% cap
    - KHÔNG hiển thị internal cost — chỉ hiện customer price
    - _Requirements: R18.2–R18.5_

  - [x] 24.2 Tạo Settings pages (Profile, Organization, GitHub)
    - Viết `src/app/(app)/settings/profile/page.tsx`: cập nhật tên, avatar
    - Viết `src/app/(app)/settings/organization/page.tsx`: org settings, member management (invite, role change, remove)
    - Viết `src/app/(app)/settings/github/page.tsx`: GitHub App installation status, connect/disconnect
    - Viết `src/lib/hooks/use-organizations.ts`
    - _Requirements: R2.3, R2.4, R3.1_

- [x] 25. Checkpoint Sprint 5 — Đảm bảo Frontend hoạt động end-to-end
  - Verify tất cả pages render không có TypeScript errors (`tsc --noEmit`)
  - Verify API client interceptors hoạt động (auth refresh, error handling)
  - Hỏi người dùng nếu có câu hỏi trước khi tiếp tục Sprint 6.

---

### Sprint 6: Testing, Polish và Integration

- [x] 26. Viết Integration Tests (Jest + Testcontainers)
  - [x] 26.1 Tạo integration test setup với real PostgreSQL và Redis
    - Cài đặt `testcontainers`, cấu hình Jest để chạy integration tests
    - Tạo `test/` setup: khởi động PostgreSQL container, chạy Prisma migrations, khởi động Redis container
    - Viết test helper `createTestApp()` bootstrap NestJS app với real DB
    - _Requirements: R24.1_

  - [ ]* 26.2 Viết integration tests cho Auth endpoints
    - Test POST `/auth/register` → POST `/auth/login` → GET authenticated endpoint flow
    - Test refresh token cycle, test logout + verify token revoked
    - Test account lockout sau 5 failed logins
    - _Requirements: R1.1–R1.8_

  - [ ]* 26.3 Viết integration tests cho multi-tenant isolation
    - Tạo 2 organizations với 2 users khác nhau
    - Assert user A không truy cập được projects/issues của user B (expect 404)
    - _Requirements: R2.5, R2.6, R22.3_

  - [ ]* 26.4 Viết integration tests cho Issue creation và AI Analysis queue
    - Test tạo Issue → verify AI_ANALYSIS job enqueued trong BullMQ
    - Test approval flow: PLAN_READY → approve → AI_CODING job enqueued
    - _Requirements: R6.4, R9.3_

- [x] 27. Wire toàn bộ AppModule và hoàn thiện backend
  - [x] 27.1 Tích hợp tất cả modules vào AppModule
    - Viết `src/app.module.ts` import tất cả feature modules: AuthModule, OrganizationsModule, ProjectsModule, GithubModule, IssuesModule, AITasksModule, PricingModule, ApprovalsModule, ActivityModule, UsageModule, NotificationsModule, SandboxModule, QueueModule, PrismaModule
    - Đăng ký GlobalExceptionFilter, ValidationPipe, LoggingInterceptor, TransformResponseInterceptor globally
    - Apply rate limiting globally (`ThrottlerModule`)
    - Verify tất cả modules compile không có circular dependency
    - _Requirements: R23.2, R23.5_

  - [x] 27.2 Viết Prisma migrations và seed data
    - Chạy `npx prisma migrate dev` tạo initial migration
    - Viết `prisma/seed.ts` với seed data: 1 admin user, 1 organization (cho development)
    - Verify tất cả indexes được tạo đúng
    - _Requirements: R24.1, R24.2_

  - [x] 27.3 Viết Prisma migrations và seed data (webwow-fe)
    - Viết `src/app/page.tsx` (root): redirect tới `/dashboard` nếu authenticated, redirect tới `/login` nếu không
    - Viết `src/app/(app)/projects/[projectId]/page.tsx` redirect tới `/overview`
    - Verify TypeScript strict mode không có errors (`tsc --noEmit`) trong webwow-fe
    - _Requirements: R25.1_

- [x] 28. Final Checkpoint — Đảm bảo toàn bộ MVP hoạt động
  - Chạy `npm test` trên webwow-be — tất cả unit tests + property tests + integration tests phải pass
  - Chạy `tsc --noEmit` trên cả webwow-be và webwow-fe — không có TypeScript errors
  - Verify Swagger UI tại `/api/docs` đầy đủ tất cả endpoints
  - Verify tất cả 16 Correctness Properties đã có test coverage
  - Hỏi người dùng nếu có câu hỏi trước khi kết thúc.


---

## Notes

- Tasks đánh dấu `*` là optional — có thể bỏ qua để tăng tốc độ MVP, nhưng **strongly recommended** để đảm bảo tính đúng đắn
- Mỗi task tham chiếu đến requirements cụ thể theo format `R{số}.{sub}` để đảm bảo traceability
- Checkpoints (tasks 5, 9, 14, 18, 25, 28) là cơ hội để dừng lại, verify và điều chỉnh hướng đi
- **16 Correctness Properties** đều có property-based tests riêng (dùng `fast-check`) — xem design.md phần Correctness Properties để biết chi tiết
- Mọi TypeScript code phải dùng strict mode; không dùng `any` mà không có comment giải thích
- Mọi query DB phải bao gồm `organizationId` filter — không có ngoại lệ
- `internalAiCost` KHÔNG BAO GIỜ xuất hiện trong API response trả về cho customer
- AI KHÔNG BAO GIỜ thực hiện code changes trước khi customer approve (R9.1)
- AI KHÔNG BAO GIỜ merge Pull Request (R11.6)
- SandboxExecutor xóa hoàn toàn workspace sau mỗi AITask (R12.6)

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "1.2", "1.3"]
    },
    {
      "id": 1,
      "tasks": ["1.4", "2.1", "2.3"]
    },
    {
      "id": 2,
      "tasks": ["2.2", "2.4", "3.1"]
    },
    {
      "id": 3,
      "tasks": ["3.2", "4.1"]
    },
    {
      "id": 4,
      "tasks": ["3.3", "3.4", "4.2"]
    },
    {
      "id": 5,
      "tasks": ["3.5", "4.3"]
    },
    {
      "id": 6,
      "tasks": ["4.4", "6.1"]
    },
    {
      "id": 7,
      "tasks": ["6.2", "7.1", "8.1"]
    },
    {
      "id": 8,
      "tasks": ["6.3", "7.2", "8.2"]
    },
    {
      "id": 9,
      "tasks": ["6.4", "7.3", "7.4", "8.3"]
    },
    {
      "id": 10,
      "tasks": ["7.5", "8.4", "10.1"]
    },
    {
      "id": 11,
      "tasks": ["10.2", "11.1"]
    },
    {
      "id": 12,
      "tasks": ["10.3", "10.4", "11.2", "12.1"]
    },
    {
      "id": 13,
      "tasks": ["11.3", "11.4", "12.2"]
    },
    {
      "id": 14,
      "tasks": ["11.5", "12.3", "13.1"]
    },
    {
      "id": 15,
      "tasks": ["12.4", "12.5", "13.2"]
    },
    {
      "id": 16,
      "tasks": ["12.6", "12.7", "13.3", "15.1"]
    },
    {
      "id": 17,
      "tasks": ["15.2", "16.1"]
    },
    {
      "id": 18,
      "tasks": ["15.3", "15.4", "16.2"]
    },
    {
      "id": 19,
      "tasks": ["15.5", "16.3", "17.1"]
    },
    {
      "id": 20,
      "tasks": ["17.2", "17.3", "17.4", "17.5"]
    },
    {
      "id": 21,
      "tasks": ["17.6", "17.7"]
    },
    {
      "id": 22,
      "tasks": ["17.8", "19.1"]
    },
    {
      "id": 23,
      "tasks": ["19.2", "19.3"]
    },
    {
      "id": 24,
      "tasks": ["20.1", "21.1"]
    },
    {
      "id": 25,
      "tasks": ["20.2", "21.2"]
    },
    {
      "id": 26,
      "tasks": ["21.3", "22.1"]
    },
    {
      "id": 27,
      "tasks": ["22.2", "22.3", "23.1"]
    },
    {
      "id": 28,
      "tasks": ["23.2", "24.1", "24.2"]
    },
    {
      "id": 29,
      "tasks": ["26.1", "27.1"]
    },
    {
      "id": 30,
      "tasks": ["26.2", "26.3", "27.2", "27.3"]
    },
    {
      "id": 31,
      "tasks": ["26.4"]
    }
  ]
}
```
