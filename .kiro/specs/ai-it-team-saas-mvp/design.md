# Design Document: AI IT Team SaaS MVP

## Overview

**AI IT Team SaaS** là nền tảng đóng vai trò đội IT AI toàn diện cho các doanh nghiệp chưa có đội kỹ thuật nội bộ.
Khách hàng kết nối GitHub repository, mô tả yêu cầu bằng ngôn ngữ tự nhiên, AI phân tích — lập kế hoạch —
trình bày ước tính chi phí — chờ khách hàng phê duyệt — rồi tự động viết code, chạy test và tạo Pull Request.

### Mục Tiêu Thiết Kế

- **Kiến trúc module hóa**: NestJS module-per-domain, Frontend page-per-feature
- **Bảo mật đa thuê bao**: `organizationId` bắt buộc trong mọi query, UUID cho mọi ID công khai
- **AI không chặn UI**: BullMQ queue, HTTP 202 ngay lập tức, polling/SSE cho live updates
- **Minh bạch với khách hàng**: Không stack trace, không internal cost lộ ra, friendly error messages
- **Extensible AI layer**: `AIProvider` interface — đổi OpenAI ↔ Anthropic qua env var

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│                  Next.js 14 App Router (webwow-fe)                  │
│         Tailwind CSS + shadcn/ui + React Query + Zustand            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ HTTPS / REST + Polling
┌─────────────────────────▼───────────────────────────────────────────┐
│                    API Gateway Layer                                 │
│            NestJS (webwow-be) — Port 3000                           │
│   JWT Auth Guard │ Rate Limiter │ Swagger /api/docs │ CORS          │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Auth    │ │   Org    │ │ Project  │ │  Issue   │ │ AITask   │ │
│  │ Module   │ │ Module   │ │ Module   │ │ Module   │ │ Module   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ GitHub   │ │ Pricing  │ │Approval  │ │Activity  │ │  Usage   │ │
│  │ Module   │ │ Module   │ │ Module   │ │ Module   │ │ Module   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└───────────┬─────────────────────────────────────────┬───────────────┘
            │ Prisma ORM                               │ BullMQ Jobs
┌───────────▼────────────┐             ┌──────────────▼───────────────┐
│    PostgreSQL DB        │             │   Redis (Queue + Cache)       │
│  (Primary Data Store)  │             │  BullMQ Queues:               │
│  - UUID PKs            │             │  • project-analysis           │
│  - soft delete         │             │  • ai-analysis                │
│  - indexes on orgId    │             │  • ai-coding                  │
│  - encrypted secrets   │             │  • sandbox-execution          │
└────────────────────────┘             │  • pr-creation                │
                                       └──────────────┬────────────────┘
                                                      │ Workers
┌─────────────────────────────────────────────────────▼────────────────┐
│                        Worker Processes                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ ProjectAnalyzer │  │ AIAnalysisAgent │  │    CodingAgent      │  │
│  │    Worker       │  │  + Planning     │  │ + SandboxExecutor   │  │
│  │                 │  │  Worker         │  │   (Docker)          │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
              ┌────────────────────┼───────────────────┐
              │                    │                   │
    ┌─────────▼────────┐  ┌────────▼───────┐  ┌───────▼─────────┐
    │  OpenAI / Claude  │  │  GitHub API    │  │  Email Service  │
    │   (AIProvider)    │  │  (Octokit)     │  │ (Resend/SMTP)   │
    └───────────────────┘  └────────────────┘  └─────────────────┘
```

### Deployment Architecture (MVP)

```
Internet → Nginx (TLS termination) → NestJS App (PM2) → PostgreSQL
                                   → BullMQ Workers (separate process)
                                   → Redis (local or managed)
Docker per AITask (ephemeral sandbox — no persistent network to prod)
```

---

## Components and Interfaces

### Backend NestJS Module Structure (webwow-be)


```
webwow-be/
├── src/
│   ├── main.ts                          # Bootstrap, global pipes, Swagger
│   ├── app.module.ts                    # Root module — imports all feature modules
│   │
│   ├── config/
│   │   ├── app.config.ts               # Port, NODE_ENV, CORS origins
│   │   ├── database.config.ts          # DATABASE_URL
│   │   ├── jwt.config.ts               # JWT_SECRET, JWT_REFRESH_SECRET, expiry
│   │   ├── ai.config.ts                # AI_PROVIDER, OPENAI_KEY, ANTHROPIC_KEY
│   │   ├── github.config.ts            # GITHUB_APP_ID, GITHUB_PRIVATE_KEY
│   │   ├── redis.config.ts             # REDIS_URL
│   │   └── email.config.ts             # RESEND_API_KEY / SMTP config
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   └── org-id.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform-response.interceptor.ts
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts  # Never expose stack traces
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   └── types/
│   │       ├── jwt-payload.type.ts
│   │       └── pagination.type.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts       # POST /auth/register, /auth/login, /auth/refresh, /auth/logout
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   ├── jwt-refresh.strategy.ts
│   │   │   │   └── github-oauth.strategy.ts
│   │   │   └── dto/
│   │   │       ├── register.dto.ts
│   │   │       ├── login.dto.ts
│   │   │       └── refresh-token.dto.ts
│   │   │
│   │   ├── organizations/
│   │   │   ├── organizations.module.ts
│   │   │   ├── organizations.controller.ts
│   │   │   ├── organizations.service.ts
│   │   │   ├── members.controller.ts
│   │   │   └── dto/
│   │   │       ├── create-organization.dto.ts
│   │   │       ├── invite-member.dto.ts
│   │   │       └── update-member-role.dto.ts
│   │   │
│   │   ├── projects/
│   │   │   ├── projects.module.ts
│   │   │   ├── projects.controller.ts
│   │   │   ├── projects.service.ts
│   │   │   ├── project-analysis.service.ts
│   │   │   ├── compatibility-scorer.service.ts
│   │   │   └── dto/
│   │   │       ├── create-project.dto.ts
│   │   │       └── update-project.dto.ts
│   │   │
│   │   ├── github/
│   │   │   ├── github.module.ts
│   │   │   ├── github.controller.ts    # GET /github/callback, /github/repos, /github/branches
│   │   │   ├── github.service.ts       # GitHub App auth, installation tokens
│   │   │   ├── github-webhook.controller.ts
│   │   │   └── octokit.provider.ts
│   │   │
│   │   ├── issues/
│   │   │   ├── issues.module.ts
│   │   │   ├── issues.controller.ts
│   │   │   ├── issues.service.ts
│   │   │   └── dto/
│   │   │       ├── create-issue.dto.ts
│   │   │       └── update-issue.dto.ts
│   │   │
│   │   ├── ai-tasks/
│   │   │   ├── ai-tasks.module.ts
│   │   │   ├── ai-tasks.controller.ts
│   │   │   ├── ai-tasks.service.ts
│   │   │   ├── state-machine.service.ts  # Enforces valid transitions
│   │   │   └── dto/
│   │   │       └── cancel-task.dto.ts
│   │   │
│   │   ├── pricing/
│   │   │   ├── pricing.module.ts
│   │   │   └── pricing.service.ts
│   │   │
│   │   ├── approvals/
│   │   │   ├── approvals.module.ts
│   │   │   ├── approvals.controller.ts  # POST /approvals/:issueId/approve|reject
│   │   │   └── approvals.service.ts
│   │   │
│   │   ├── activity/
│   │   │   ├── activity.module.ts
│   │   │   ├── activity.controller.ts
│   │   │   └── activity.service.ts     # ActivityLogger
│   │   │
│   │   ├── usage/
│   │   │   ├── usage.module.ts
│   │   │   ├── usage.controller.ts
│   │   │   └── usage.service.ts
│   │   │
│   │   └── notifications/
│   │       ├── notifications.module.ts
│   │       └── notifications.service.ts
│   │
│   ├── ai/
│   │   ├── providers/
│   │   │   ├── ai-provider.interface.ts    # IAIProvider
│   │   │   ├── openai.provider.ts
│   │   │   └── anthropic.provider.ts
│   │   ├── agents/
│   │   │   ├── analysis.agent.ts           # AIAnalysisAgent
│   │   │   ├── planning.agent.ts           # PlanningAgent
│   │   │   ├── coding.agent.ts             # CodingAgent
│   │   │   └── review.agent.ts
│   │   ├── prompts/
│   │   │   ├── project-analysis.prompt.ts
│   │   │   ├── issue-analysis.prompt.ts
│   │   │   ├── planning.prompt.ts
│   │   │   ├── coding.prompt.ts
│   │   │   └── review.prompt.ts
│   │   └── schemas/
│   │       ├── implementation-plan.schema.ts  # Zod/JSON schema
│   │       ├── analysis-result.schema.ts
│   │       └── review-result.schema.ts
│   │
│   ├── sandbox/
│   │   ├── sandbox.module.ts
│   │   ├── sandbox-executor.service.ts    # Docker container management
│   │   └── sandbox.types.ts
│   │
│   ├── queue/
│   │   ├── queue.module.ts
│   │   ├── queue.constants.ts             # Queue names
│   │   └── workers/
│   │       ├── project-analysis.worker.ts
│   │       ├── ai-analysis.worker.ts
│   │       ├── ai-coding.worker.ts
│   │       └── pr-creation.worker.ts
│   │
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── test/
│   ├── unit/
│   └── e2e/
└── docker/
    └── sandbox/
        └── Dockerfile                     # Sandbox container image
```


### Frontend Next.js App Structure (webwow-fe)

```
webwow-fe/
├── src/
│   ├── app/                                  # Next.js 14 App Router
│   │   ├── layout.tsx                        # Root layout — Providers, Toaster
│   │   ├── page.tsx                          # Landing / redirect to /dashboard
│   │   │
│   │   ├── (auth)/                           # Route group — no main nav
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── verify-email/page.tsx
│   │   │   └── forgot-password/page.tsx
│   │   │
│   │   └── (app)/                            # Route group — authenticated, with sidebar
│   │       ├── layout.tsx                    # App shell: sidebar + topbar
│   │       ├── dashboard/page.tsx            # Dashboard overview
│   │       ├── projects/
│   │       │   ├── page.tsx                  # Projects list
│   │       │   ├── new/page.tsx              # Connect GitHub repo
│   │       │   └── [projectId]/
│   │       │       ├── page.tsx              # Project detail — tab router
│   │       │       ├── overview/page.tsx
│   │       │       ├── issues/
│   │       │       │   ├── page.tsx
│   │       │       │   ├── new/page.tsx
│   │       │       │   └── [issueId]/page.tsx
│   │       │       ├── architecture/page.tsx
│   │       │       ├── ai-tasks/
│   │       │       │   ├── page.tsx
│   │       │       │   └── [taskId]/page.tsx
│   │       │       ├── pull-requests/page.tsx
│   │       │       └── activity/page.tsx
│   │       ├── usage/page.tsx                # Billing & usage
│   │       └── settings/
│   │           ├── profile/page.tsx
│   │           ├── organization/page.tsx
│   │           └── github/page.tsx           # GitHub App install
│   │
│   ├── components/
│   │   ├── ui/                              # shadcn/ui re-exports
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── badge.tsx
│   │   │   └── ... (all shadcn components)
│   │   │
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── topbar.tsx
│   │   │   └── breadcrumb.tsx
│   │   │
│   │   ├── dashboard/
│   │   │   ├── stats-cards.tsx             # Total projects, active tasks, cost
│   │   │   ├── activity-feed.tsx           # Recent 20 AI events
│   │   │   └── pending-approvals.tsx
│   │   │
│   │   ├── projects/
│   │   │   ├── project-card.tsx
│   │   │   ├── project-tabs.tsx            # 6-tab navigation
│   │   │   ├── compatibility-badge.tsx
│   │   │   └── architecture-view.tsx
│   │   │
│   │   ├── issues/
│   │   │   ├── issue-form.tsx
│   │   │   ├── issue-card.tsx
│   │   │   ├── issue-status-badge.tsx
│   │   │   ├── implementation-plan-view.tsx
│   │   │   ├── cost-estimate-card.tsx
│   │   │   └── approval-panel.tsx
│   │   │
│   │   ├── ai-tasks/
│   │   │   ├── task-state-timeline.tsx     # Visual state machine progress
│   │   │   ├── task-live-status.tsx        # Polls every 10s when active
│   │   │   └── activity-log-viewer.tsx     # 2-level log toggle
│   │   │
│   │   └── common/
│   │       ├── error-boundary.tsx
│   │       ├── loading-skeleton.tsx
│   │       └── empty-state.tsx
│   │
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts                   # Axios instance + interceptors
│   │   │   ├── auth.api.ts
│   │   │   ├── projects.api.ts
│   │   │   ├── issues.api.ts
│   │   │   ├── ai-tasks.api.ts
│   │   │   ├── activity.api.ts
│   │   │   └── usage.api.ts
│   │   ├── hooks/
│   │   │   ├── use-live-task.ts            # Polling hook for active AITask
│   │   │   ├── use-organizations.ts
│   │   │   └── use-auth.ts
│   │   └── utils/
│   │       ├── format-currency.ts
│   │       ├── format-date.ts
│   │       └── cn.ts
│   │
│   ├── stores/
│   │   ├── auth.store.ts                   # Zustand — user, tokens
│   │   └── org.store.ts                    # Zustand — active organization
│   │
│   └── types/
│       ├── api.types.ts                    # Response shapes mirroring backend DTOs
│       └── models.types.ts
│
├── public/
└── tailwind.config.ts
```

---

## Data Models

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────── ENUMS ───────────

enum OrgRole {
  OWNER
  ADMIN
  MEMBER
}

enum ProjectStatus {
  PENDING_ANALYSIS
  ANALYZING
  ANALYSIS_FAILED
  ACTIVE
  ARCHIVED
}

enum CompatibilityTier {
  FULL_AI_SUPPORT
  AI_ASSISTED
  LIMITED_SUPPORT
  UNSUPPORTED
}

enum IssueType {
  BUG
  FEATURE
  REFACTOR
  PERFORMANCE
  SECURITY
  DEPENDENCY
  OTHER
}

enum IssuePriority {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum IssueStatus {
  ANALYZING
  ANALYSIS_FAILED
  PLAN_READY
  APPROVED
  REJECTED
  IN_PROGRESS
  COMPLETED
  FAILED
  CANCELLED
}

enum AITaskStatus {
  QUEUED
  ANALYZING
  PLANNING
  WAITING_APPROVAL
  APPROVED
  PREPARING
  CODING
  TESTING
  FIXING
  REVIEWING
  CREATING_PR
  COMPLETED
  FAILED
  CANCELLED
}

enum ComplexityLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum PullRequestStatus {
  OPEN
  CLOSED
  MERGED
}

enum ActivityEventType {
  STATE_CHANGE
  AI_CALL
  FILE_CHANGED
  COMMAND_EXECUTED
  TEST_RESULT
  PR_CREATED
  APPROVAL_DECISION
  ERROR
}

// ─────────── MODELS ───────────

model User {
  id                String               @id @default(uuid())
  email             String               @unique
  passwordHash      String?              // null for OAuth-only accounts
  emailVerified     Boolean              @default(false)
  emailVerifyToken  String?
  resetPasswordToken String?
  resetPasswordExpiry DateTime?
  failedLoginAttempts Int               @default(0)
  lockedUntil       DateTime?
  githubId          String?              @unique
  githubUsername    String?
  name              String?
  avatarUrl         String?
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt
  deletedAt         DateTime?

  memberships       OrganizationMember[]
  refreshTokens     RefreshToken[]

  @@index([email])
  @@index([githubId])
}

model RefreshToken {
  id          String   @id @default(uuid())
  token       String   @unique
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())

  @@index([token])
  @@index([userId])
}

model Organization {
  id          String               @id @default(uuid())
  name        String
  slug        String               @unique
  logoUrl     String?
  usageCap    Float                @default(500)   // monthly USD cap
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt
  deletedAt   DateTime?

  members     OrganizationMember[]
  projects    Project[]
  issues      Issue[]
  aiTasks     AITask[]
  usages      Usage[]
  activities  ActivityLog[]

  @@index([slug])
}

model OrganizationMember {
  id             String       @id @default(uuid())
  organizationId String
  userId         String
  role           OrgRole
  invitedBy      String?
  inviteToken    String?
  inviteExpiry   DateTime?
  joinedAt       DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])
  @@index([organizationId])
  @@index([userId])
  @@index([inviteToken])
}
```


```prisma
model Project {
  id                  String            @id @default(uuid())
  organizationId      String
  name                String
  description         String?
  githubRepoFullName  String            // "owner/repo"
  githubInstallationId String
  defaultBranch       String            @default("main")
  status              ProjectStatus     @default(PENDING_ANALYSIS)
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  deletedAt           DateTime?

  organization        Organization      @relation(fields: [organizationId], references: [id])
  analysis            ProjectAnalysis?
  issues              Issue[]
  aiTasks             AITask[]
  pullRequests        PullRequest[]

  @@index([organizationId])
  @@index([status])
  @@index([organizationId, status])
}

model ProjectAnalysis {
  id                  String            @id @default(uuid())
  projectId           String            @unique
  organizationId      String

  // Technical profile
  primaryLanguage     String?
  frameworks          String[]
  databases           String[]
  buildTools          String[]
  packageManager      String?

  // Compatibility
  compatibilityScore  Int               // 0-100
  compatibilityTier   CompatibilityTier
  compatibilityNotes  Json              // [{factor, score, note, suggestion}]

  // Codebase summary
  directoryStructure  Json              // Masked, no secrets
  mainDependencies    Json              // [{name, version, purpose}]
  detectedModules     Json              // [{name, path, type}]
  detectedEndpoints   Json?
  testCoverage        Float?
  buildScripts        Json?             // {test, build, lint, format}
  knownIssues         Json?

  analyzedAt          DateTime          @default(now())
  updatedAt           DateTime          @updatedAt

  project             Project           @relation(fields: [projectId], references: [id])

  @@index([organizationId])
  @@index([projectId])
}

model GitHubInstallation {
  id              String   @id @default(uuid())
  organizationId  String   @unique
  installationId  String   @unique
  encryptedToken  String               // AES-256 encrypted installation token
  tokenExpiresAt  DateTime?
  githubAccountId String
  githubAccountLogin String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId])
  @@index([installationId])
}

model Issue {
  id                  String          @id @default(uuid())
  organizationId      String
  projectId           String
  createdBy           String          // userId

  title               String
  description         String          // Customer natural language
  type                IssueType
  priority            IssuePriority
  status              IssueStatus     @default(ANALYZING)

  // AI Analysis results
  aiDiagnosis         String?
  affectedFiles       String[]
  riskLevel           ComplexityLevel?
  complexity          ComplexityLevel?
  feasibilityNotes    String?

  // Plan
  implementationPlan  Json?           // ImplementationPlan JSON

  // Rejection
  rejectionReason     String?

  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  deletedAt           DateTime?

  organization        Organization    @relation(fields: [organizationId], references: [id])
  project             Project         @relation(fields: [projectId], references: [id])
  costEstimate        CostEstimate?
  aiTasks             AITask[]
  pullRequests        PullRequest[]

  @@index([organizationId])
  @@index([projectId])
  @@index([status])
  @@index([organizationId, projectId, status])
  @@index([createdAt])
}

model CostEstimate {
  id                  String   @id @default(uuid())
  issueId             String   @unique
  organizationId      String

  // Internal — NEVER exposed to customer
  internalAiCost      Float    // USD
  internalTokens      Int

  // Customer-facing
  customerPriceMin    Float
  customerPriceBase   Float
  customerPriceMax    Float
  developerComparison Float?   // equivalent cost if hiring developer

  expiresAt           DateTime
  isExpired           Boolean  @default(false)

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  issue               Issue    @relation(fields: [issueId], references: [id])

  @@index([issueId])
  @@index([organizationId])
  @@index([expiresAt])
}

model AITask {
  id              String       @id @default(uuid())
  organizationId  String
  projectId       String
  issueId         String

  status          AITaskStatus @default(QUEUED)
  currentStep     String?

  // Sandbox execution
  sandboxId       String?
  branchName      String?      // ai/{issueId}-{slug}

  // Results
  filesChanged    String[]
  testResult      Json?        // {passed, failed, coverage}
  buildResult     Json?        // {success, output}
  reviewSummary   String?

  // Cost tracking
  actualTokens    Int          @default(0)
  actualCost      Float        @default(0)

  startedAt       DateTime?
  completedAt     DateTime?
  failedAt        DateTime?
  failureReason   String?      // Customer-friendly message

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])
  project         Project      @relation(fields: [projectId], references: [id])
  issue           Issue        @relation(fields: [issueId], references: [id])
  steps           AITaskStep[]
  pullRequests    PullRequest[]

  @@index([organizationId])
  @@index([projectId])
  @@index([issueId])
  @@index([status])
  @@index([organizationId, status])
  @@index([createdAt])
}

model AITaskStep {
  id          String       @id @default(uuid())
  taskId      String
  stepName    String       // e.g. "clone_repo", "run_tests"
  status      String       // PENDING | RUNNING | SUCCESS | FAILED
  command     String?
  output      String?
  exitCode    Int?
  durationMs  Int?
  createdAt   DateTime     @default(now())
  completedAt DateTime?

  task        AITask       @relation(fields: [taskId], references: [id])

  @@index([taskId])
}

model PullRequest {
  id              String            @id @default(uuid())
  organizationId  String
  projectId       String
  issueId         String
  taskId          String

  githubPrNumber  Int
  githubPrUrl     String
  title           String
  branchName      String
  status          PullRequestStatus @default(OPEN)

  mergedAt        DateTime?
  closedAt        DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  issue           Issue             @relation(fields: [issueId], references: [id])
  task            AITask            @relation(fields: [taskId], references: [id])
  project         Project           @relation(fields: [projectId], references: [id])

  @@index([organizationId])
  @@index([projectId])
  @@index([issueId])
  @@index([taskId])
  @@index([status])
}

model ActivityLog {
  id              String            @id @default(uuid())
  organizationId  String
  projectId       String?
  issueId         String?
  taskId          String?

  eventType       ActivityEventType
  agentType       String?           // AIAnalysisAgent | PlanningAgent | CodingAgent
  aiModel         String?           // gpt-4o | claude-3-5-sonnet
  tokensUsed      Int?
  estimatedCost   Float?
  durationMs      Int?

  // Customer-friendly log (shown in UI)
  friendlyMessage String
  // Technical detail (internal only)
  technicalDetail Json?

  oldStatus       String?
  newStatus       String?
  actorId         String?           // userId or "system"
  ipAddress       String?

  createdAt       DateTime          @default(now())

  organization    Organization      @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
  @@index([projectId])
  @@index([issueId])
  @@index([taskId])
  @@index([createdAt])
  @@index([organizationId, createdAt])
}

model Usage {
  id              String   @id @default(uuid())
  organizationId  String
  year            Int
  month           Int      // 1-12

  totalTasks      Int      @default(0)
  totalTokens     Int      @default(0)
  internalCost    Float    @default(0)  // NEVER shown to customer
  customerCost    Float    @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, year, month])
  @@index([organizationId])
  @@index([organizationId, year, month])
}
```


---

## AITask State Machine

### Sơ Đồ Trạng Thái

```
                        ┌─────────────────────────────────┐
                        │           QUEUED                │ ←── Issue được phê duyệt
                        └─────────────────────────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────┐
                        │          ANALYZING              │ AIAnalysisAgent running
                        └─────────────────────────────────┘
                                        │
                            ┌───────────┴────────────┐
                            ▼                        ▼
                        FAILED                   PLANNING    PlanningAgent running
                                                     │
                                                     ▼
                                          WAITING_APPROVAL  ←── Chờ customer phê duyệt
                                                     │
                            ┌───────────┬────────────┘
                            ▼           ▼
                        CANCELLED     APPROVED    Customer phê duyệt
                                        │
                                        ▼
                        ┌─────────────────────────────────┐
                        │          PREPARING              │ Clone repo, create branch
                        └─────────────────────────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────┐
                        │           CODING                │ CodingAgent writing files
                        └─────────────────────────────────┘
                                        │
                                        ▼
                        ┌─────────────────────────────────┐
                        │           TESTING               │ Run formatter/lint/test/build
                        └─────────────────────────────────┘
                                        │
                              ┌─────────┴──────────┐
                              ▼                    ▼
                           FIXING             REVIEWING    All checks passed
                              │                    │
                    ┌─────────┘                    ▼
                    │ (max 3 retries)      CREATING_PR    Create GitHub PR
                    ▼                              │
                 FAILED                            ▼
                                             COMPLETED    ✓

Bất kỳ trạng thái nào cũng có thể → CANCELLED (nếu customer cancel trước khi CODING)
Bất kỳ trạng thái active nào → FAILED (nếu lỗi hệ thống nghiêm trọng)
```

### Valid Transitions Map

```typescript
// src/modules/ai-tasks/state-machine.service.ts
export const VALID_TRANSITIONS: Record<AITaskStatus, AITaskStatus[]> = {
  QUEUED:           ['ANALYZING', 'CANCELLED', 'FAILED'],
  ANALYZING:        ['PLANNING', 'FAILED', 'CANCELLED'],
  PLANNING:         ['WAITING_APPROVAL', 'FAILED'],
  WAITING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED:         ['PREPARING', 'FAILED'],
  PREPARING:        ['CODING', 'FAILED'],
  CODING:           ['TESTING', 'FAILED'],
  TESTING:          ['REVIEWING', 'FIXING', 'FAILED'],
  FIXING:           ['TESTING', 'FAILED'],       // Back to TESTING after fix attempt
  REVIEWING:        ['CREATING_PR', 'FAILED'],
  CREATING_PR:      ['COMPLETED', 'FAILED'],
  COMPLETED:        [],                           // Terminal
  FAILED:           [],                           // Terminal
  CANCELLED:        [],                           // Terminal
};
```

---

## REST API Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | Public | Đăng ký tài khoản |
| POST | `/api/auth/login` | Public | Đăng nhập → JWT pair |
| POST | `/api/auth/refresh` | Public | Làm mới access token |
| POST | `/api/auth/logout` | JWT | Revoke refresh token |
| GET  | `/api/auth/github` | Public | Redirect OAuth GitHub |
| GET  | `/api/auth/github/callback` | Public | GitHub OAuth callback |
| POST | `/api/auth/verify-email` | Public | Xác thực email |
| POST | `/api/auth/forgot-password` | Public | Gửi link reset |
| POST | `/api/auth/reset-password` | Public | Đặt lại mật khẩu |

### Organizations

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/organizations` | JWT | — | Tạo organization |
| GET  | `/api/organizations` | JWT | — | Danh sách org của user |
| GET  | `/api/organizations/:id` | JWT | Member | Thông tin org |
| PATCH | `/api/organizations/:id` | JWT | Owner/Admin | Cập nhật org |
| DELETE | `/api/organizations/:id` | JWT | Owner | Soft delete org |
| POST | `/api/organizations/:id/members/invite` | JWT | Owner/Admin | Mời thành viên |
| GET  | `/api/organizations/:id/members` | JWT | Member | Danh sách thành viên |
| PATCH | `/api/organizations/:id/members/:userId` | JWT | Owner/Admin | Đổi role |
| DELETE | `/api/organizations/:id/members/:userId` | JWT | Owner/Admin | Xóa thành viên |

### GitHub Integration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/api/github/install-url` | JWT | URL cài đặt GitHub App |
| GET  | `/api/github/callback` | JWT | GitHub App installation callback |
| GET  | `/api/github/repos` | JWT | Danh sách repos có quyền |
| GET  | `/api/github/repos/:owner/:repo/branches` | JWT | Danh sách branches |
| POST | `/api/github/webhook` | Signature | GitHub webhook handler |

### Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects` | JWT | Tạo project (kết nối repo) |
| GET  | `/api/projects` | JWT | Danh sách projects theo org |
| GET  | `/api/projects/:id` | JWT | Chi tiết project |
| PATCH | `/api/projects/:id` | JWT | Cập nhật project |
| DELETE | `/api/projects/:id` | JWT | Soft delete project |
| GET  | `/api/projects/:id/analysis` | JWT | Kết quả phân tích |
| POST | `/api/projects/:id/reanalyze` | JWT | Kích hoạt phân tích lại |

### Issues

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects/:projectId/issues` | JWT | Tạo issue mới |
| GET  | `/api/projects/:projectId/issues` | JWT | Danh sách issues |
| GET  | `/api/projects/:projectId/issues/:id` | JWT | Chi tiết issue |
| PATCH | `/api/projects/:projectId/issues/:id` | JWT | Cập nhật issue |
| DELETE | `/api/projects/:projectId/issues/:id` | JWT | Soft delete issue |

### Approvals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/issues/:issueId/approve` | JWT | Phê duyệt kế hoạch AI |
| POST | `/api/issues/:issueId/reject` | JWT | Từ chối kế hoạch |

### AI Tasks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/api/ai-tasks` | JWT | Danh sách tasks theo org |
| GET  | `/api/ai-tasks/:id` | JWT | Chi tiết task + status |
| POST | `/api/ai-tasks/:id/cancel` | JWT | Cancel task |
| GET  | `/api/ai-tasks/:id/logs` | JWT | Activity logs của task |

### Activity

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/api/activity` | JWT | Recent activity feed (org-scoped) |
| GET  | `/api/activity/:taskId` | JWT | Logs của một task cụ thể |

### Usage & Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/api/usage` | JWT | Usage tháng hiện tại |
| GET  | `/api/usage/history` | JWT | Lịch sử usage theo tháng |

---

## Queue và Worker Design

### Queue Names và Job Types

```typescript
// src/queue/queue.constants.ts
export const QUEUES = {
  PROJECT_ANALYSIS:  'project-analysis',
  AI_ANALYSIS:       'ai-analysis',
  AI_CODING:         'ai-coding',
  PR_CREATION:       'pr-creation',
  NOTIFICATION:      'notification',
} as const;

export const CONCURRENCY = {
  PROJECT_ANALYSIS: 3,
  AI_ANALYSIS:      5,
  AI_CODING:        5,   // Max 5 concurrent coding tasks (MVP)
  PR_CREATION:      10,
};
```

### Job Definitions

```typescript
// Job: PROJECT_ANALYSIS
interface ProjectAnalysisJob {
  projectId: string;
  organizationId: string;
  githubInstallationId: string;
  repoFullName: string;
  branch: string;
}

// Job: AI_ANALYSIS
interface AIAnalysisJob {
  issueId: string;
  projectId: string;
  organizationId: string;
  retryCount: number;
}

// Job: AI_CODING
interface AICodingJob {
  taskId: string;
  issueId: string;
  projectId: string;
  organizationId: string;
  implementationPlan: ImplementationPlan;
}

// Job: PR_CREATION
interface PRCreationJob {
  taskId: string;
  issueId: string;
  projectId: string;
  organizationId: string;
  branchName: string;
}
```

### Retry Configuration

```typescript
// Exponential backoff: 30s → 2min → 10min
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30_000,  // 30 seconds initial delay
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 200 },
};
```

### Worker: ProjectAnalysis

```
ProjectAnalysisWorker.process(job):
  1. Fetch GitHubInstallation token (decrypt)
  2. Clone repo to temp directory
  3. Read config files (package.json, tsconfig, Dockerfile, etc.)
  4. Detect frameworks, languages, databases
  5. Mask secrets (entropy-based detection)
  6. Calculate compatibility score via CompatibilityScorer
  7. Persist ProjectAnalysis record
  8. Update Project status → ACTIVE
  9. Emit notification to org OWNER
  10. Cleanup temp directory
  Error → Update Project status → ANALYSIS_FAILED
```

### Worker: AIAnalysis

```
AIAnalysisWorker.process(job):
  1. Load ProjectContextProvider (cached project knowledge)
  2. Call AIProvider with IssueAnalysisPrompt
  3. Validate response against AnalysisResultSchema
  4. Call AIProvider with PlanningPrompt
  5. Validate response against ImplementationPlanSchema
  6. Call PricingService.calculate(plan)
  7. Persist analysis + ImplementationPlan + CostEstimate to Issue
  8. Update Issue status → PLAN_READY
  9. Emit notification to customer
  Retry → exponential backoff × 3
  Max retries → Issue status → ANALYSIS_FAILED
```

### Worker: AICoding

```
AICodingWorker.process(job):
  1. Update AITask status → PREPARING
  2. Create Docker sandbox container
  3. Clone repo in sandbox
  4. Create branch: ai/{issueId}-{slug}
  5. Update AITask status → CODING
  6. For each step in ImplementationPlan:
     a. Read/write only approved files
     b. Log every file operation to ActivityLog
  7. Update AITask status → TESTING
  8. Run: formatter → linter → tests → build
  9. If any fail → FIXING (max 3 attempts)
     - Call AIProvider with fix context
     - Re-run failed checks
  10. Update AITask status → REVIEWING
  11. Commit with Conventional Commits message
  12. Push branch
  13. Enqueue PR_CREATION job
  14. Cleanup sandbox
  Error → FAILED with customer-friendly message
```

---

## AI Agent Architecture

### IAIProvider Interface

```typescript
// src/ai/providers/ai-provider.interface.ts
export interface AICallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseSchema?: object;  // JSON schema for validation
}

export interface AIResponse<T> {
  content: T;
  inputTokens: number;
  outputTokens: number;
  model: string;
  estimatedCostUsd: number;
}

export interface IAIProvider {
  call<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: AICallOptions,
  ): Promise<AIResponse<T>>;

  getProviderName(): string;
}
```

### Prompt Classes

```typescript
// src/ai/prompts/issue-analysis.prompt.ts
export class IssueAnalysisPrompt {
  static buildSystem(): string {
    return `You are a senior software engineer analyzing a customer issue request.
    Your job is to:
    1. Identify which files in the codebase need to change
    2. Assess feasibility and complexity
    3. Identify risks
    
    CRITICAL: Only reference files that actually exist in the provided project context.
    CRITICAL: Return ONLY valid JSON matching the provided schema.
    NEVER fabricate file names, function names, or module names.`;
  }

  static buildUser(issue: Issue, projectContext: ProjectContext): string {
    return `
    PROJECT CONTEXT:
    ${JSON.stringify(projectContext, null, 2)}
    
    CUSTOMER REQUEST:
    Title: ${issue.title}
    Description: ${issue.description}
    Type: ${issue.type}
    Priority: ${issue.priority}
    
    Analyze this request and return a JSON object matching the analysis schema.`;
  }
}

// src/ai/prompts/planning.prompt.ts
export class PlanningPrompt {
  static buildSystem(): string {
    return `You are a senior software architect creating an implementation plan.
    Create a precise, ordered list of steps to implement the analyzed changes.
    
    CRITICAL: Only include files that were identified in the analysis phase.
    CRITICAL: Each step must have: type (CREATE/MODIFY/DELETE), filePath, description, testRequired.
    CRITICAL: Return ONLY valid JSON matching the ImplementationPlan schema.`;
  }

  static buildUser(
    issue: Issue,
    analysisResult: AnalysisResult,
    projectContext: ProjectContext,
  ): string {
    return `
    ANALYSIS RESULT:
    ${JSON.stringify(analysisResult, null, 2)}
    
    Create a detailed ImplementationPlan for this analyzed issue.`;
  }
}
```

### JSON Schemas (Zod)

```typescript
// src/ai/schemas/implementation-plan.schema.ts
import { z } from 'zod';

export const ImplementationStepSchema = z.object({
  order:        z.number().int().positive(),
  type:         z.enum(['CREATE', 'MODIFY', 'DELETE']),
  filePath:     z.string(),
  description:  z.string(),
  testRequired: z.boolean(),
  rollbackNote: z.string().optional(),
});

export const ImplementationPlanSchema = z.object({
  summary:          z.string(),
  steps:            z.array(ImplementationStepSchema),
  testsToWrite:     z.array(z.string()),
  rollbackStrategy: z.string(),
  estimatedMinutes: z.number().int(),
  complexityLevel:  z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});

export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;
```

---

## Security Design

### JWT Authentication Flow

```
1. Login Request
   Client → POST /api/auth/login {email, password}
   
2. Validation
   AuthService:
   - Find user by email
   - Check if account is locked (lockedUntil > now)
   - Compare password with bcrypt.compare()
   - On failure: increment failedLoginAttempts, lock if >= 5
   - On success: reset failedLoginAttempts
   
3. Token Issuance
   AuthService:
   - Generate accessToken: JWT signed HS256, payload {sub, email, orgIds}, exp 15min
   - Generate refreshToken: UUID stored in RefreshToken table, exp 7 days
   - Return: { accessToken, refreshToken, user }
   
4. Request Authentication
   Client → GET /api/projects (Header: Authorization: Bearer <accessToken>)
   JwtStrategy:
   - Verify signature and expiry
   - Load user from DB (or cache)
   - Attach to request.user
   
5. Token Refresh
   Client → POST /api/auth/refresh {refreshToken}
   AuthService:
   - Find RefreshToken in DB (not expired, not revoked)
   - Issue new accessToken
   - Optionally rotate refreshToken (sliding window)
   
6. Logout
   AuthService:
   - Set RefreshToken.revokedAt = now
   - Clear client-side tokens
```

### Multi-Tenant Data Isolation

```typescript
// Pattern enforced in EVERY service method
// src/modules/projects/projects.service.ts
async findById(projectId: string, organizationId: string): Promise<Project> {
  const project = await this.prisma.project.findFirst({
    where: {
      id: projectId,
      organizationId,          // ← MANDATORY: never omit
      deletedAt: null,
    },
  });
  
  if (!project) {
    // Return same 404 regardless of whether project doesn't exist
    // or belongs to another org (prevents org enumeration)
    throw new NotFoundException('Dự án không tồn tại');
  }
  
  return project;
}
```

### Secret Encryption

```typescript
// GitHub installation tokens encrypted at rest
// src/modules/github/github.service.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encryptToken(plaintext: string, key: string): string {
  const iv = randomBytes(16);
  const derivedKey = scryptSync(key, 'salt', 32);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(b => b.toString('hex')).join(':');
}
```

### Rate Limiting

```typescript
// src/main.ts — applied globally
app.use(
  rateLimit({
    windowMs: 60 * 1000,      // 1 minute
    max: 100,                  // standard endpoints
    standardHeaders: true,
  })
);

// Stricter limits on AI endpoints — applied per-route
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('issues')
async createIssue() { ... }
```

---

## Pricing Service Design

```typescript
// src/modules/pricing/pricing.service.ts

export interface PricingInput {
  complexity: ComplexityLevel;
  estimatedTokens: number;
  stepCount: number;
  riskLevel: ComplexityLevel;
  projectSizeKb: number;
}

const COMPLEXITY_MULTIPLIER = {
  LOW:      1.0,
  MEDIUM:   1.8,
  HIGH:     3.2,
  CRITICAL: 5.0,
};

const PRICE_MARGIN = 2.5;       // Customer pays 2.5× internal AI cost
const VARIANCE_FACTOR = 0.20;   // ±20% range

@Injectable()
export class PricingService {
  calculate(input: PricingInput): CostEstimateData {
    // Internal cost
    const tokenCostUsd = (input.estimatedTokens / 1_000_000) * 15; // GPT-4o pricing
    const internalCost = tokenCostUsd * COMPLEXITY_MULTIPLIER[input.complexity];

    // Customer pricing
    const base = internalCost * PRICE_MARGIN;
    const min  = base * (1 - VARIANCE_FACTOR);
    const max  = base * (1 + VARIANCE_FACTOR);

    // Developer comparison (rough: $75/hr, estimated hours by complexity)
    const devHours = { LOW: 2, MEDIUM: 6, HIGH: 16, CRITICAL: 40 };
    const developerComparison = devHours[input.complexity] * 75;

    return {
      internalAiCost:      internalCost,
      internalTokens:      input.estimatedTokens,
      customerPriceMin:    min,
      customerPriceBase:   base,
      customerPriceMax:    max,
      developerComparison,
      expiresAt:           new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}
```

---

## Sandbox Executor Design

```typescript
// src/sandbox/sandbox-executor.service.ts
export interface SandboxConfig {
  taskId:      string;
  repoUrl:     string;
  branch:      string;
  aiToken:     string;  // Temporary token for this task only
}

export interface CommandResult {
  command:    string;
  stdout:     string;
  stderr:     string;
  exitCode:   number;
  durationMs: number;
}

@Injectable()
export class SandboxExecutorService {
  async create(config: SandboxConfig): Promise<string> { // Returns containerId
    // docker run --rm \
    //   --cpus="2" \
    //   --memory="4g" \
    //   --network="sandbox-net" \    ← isolated network, no prod access
    //   --read-only-except=/workspace \
    //   --tmpfs /tmp:size=1g \
    //   ai-sandbox:latest
  }

  async exec(containerId: string, command: string): Promise<CommandResult> {
    // docker exec with timeout enforcement (30min total)
    // Log every command to ActivityLog
  }

  async destroy(containerId: string): Promise<void> {
    // docker stop + docker rm
    // Remove workspace volume
  }
}
```

### Docker Sandbox Network Policy

```yaml
# docker/sandbox/docker-compose.sandbox.yml
networks:
  sandbox-net:
    driver: bridge
    internal: false   # Allow outbound to GitHub + package registries
    
# iptables rules block:
# - 10.0.0.0/8 (internal)
# - 172.16.0.0/12 (internal)
# - 192.168.0.0/16 (internal)
# Allow only:
# - github.com, api.github.com
# - registry.npmjs.org, pypi.org
```


---

## Correctness Properties

*Một property là đặc tính hoặc hành vi phải đúng trên mọi lần thực thi hợp lệ của hệ thống — về cơ bản là một phát biểu hình thức về những gì phần mềm phải làm. Property là cầu nối giữa đặc tả dạng ngôn ngữ tự nhiên và đảm bảo tính đúng đắn có thể kiểm chứng tự động.*

Phần dưới đây chuyển đổi các acceptance criteria thành property có thể kiểm tra bằng property-based testing. Sau khi phân tích prework, một số property có thể gộp lại:

- **Property 5** (tạo issue thành công) và **Property 6** (từ chối issue rỗng) được gộp với **Property 12** (isolation) — vì chúng kiểm tra logic lớp validation, không phải invariant riêng lẻ.
- **Property 7** (cost margin) bao trùm **Property 8** (variance range) nên gộp thành một.
- Các property về dashboard load time (Req 14.3) là non-functional, chuyển sang integration test.

### Property 1: Xác Thực Định Dạng Email và Mật Khẩu

*For any* chuỗi email, hàm `validateEmail(input)` phải trả về `true` khi và chỉ khi chuỗi đó có định dạng hợp lệ theo RFC 5321 (có `@`, có domain, không có ký tự cấm). *For any* chuỗi mật khẩu, `validatePassword(input)` phải trả về `true` khi và chỉ khi độ dài ≥ 8 ký tự.

**Validates: Requirements 1.1**

### Property 2: JWT Encode/Decode Round-Trip

*For any* user payload hợp lệ `{sub, email}`, việc encode thành JWT rồi decode lại phải cho ra payload tương đương. Token không được decode thành công khi đã hết hạn hoặc bị ký sai.

**Validates: Requirements 1.3, 1.4**

### Property 3: Khóa Tài Khoản Sau N Lần Thất Bại

*For any* số nguyên N ≥ 5, sau N lần đăng nhập sai liên tiếp, tài khoản phải ở trạng thái locked (`lockedUntil > now`). *For any* N < 5, tài khoản không được khóa.

**Validates: Requirements 1.5**

### Property 4: Bcrypt Password Hash Round-Trip

*For any* chuỗi mật khẩu `pwd`, `bcrypt.verify(pwd, bcrypt.hash(pwd, 12))` phải trả về `true`. Mọi hash đều phải khác với plaintext (`hash !== pwd`). Hai lần hash cùng password phải cho kết quả khác nhau (salt ngẫu nhiên).

**Validates: Requirements 1.9**

### Property 5: Multi-Tenant Data Isolation

*For any* authenticated request của user thuộc `orgA`, không một resource nào trả về trong response được có `organizationId` khác `orgA`. Truy cập resource của `orgB` phải trả về 403 hoặc 404.

**Validates: Requirements 2.5, 2.6, 22.3**

### Property 6: Compatibility Score trong Khoảng [0, 100] và Phân Loại Đúng

*For any* `ProjectAnalysis` input hợp lệ, `CompatibilityScorer.score(analysis)` phải trả về số nguyên trong `[0, 100]`. Phân loại tier phải tuân theo: `[0,39] → UNSUPPORTED`, `[40,69] → LIMITED_SUPPORT`, `[70,89] → AI_ASSISTED`, `[90,100] → FULL_AI_SUPPORT` — các tier này phải loại trừ lẫn nhau và bao phủ toàn bộ khoảng.

**Validates: Requirements 5.1, 5.2**

### Property 7: Customer Price Luôn ≥ Internal AI Cost (Margin Dương)

*For any* `PricingInput`, `CostEstimate.customerPriceBase` phải luôn lớn hơn `CostEstimate.internalAiCost`. Khoảng biến động phải thỏa mãn: `customerPriceMax - customerPriceMin ≈ 0.4 × customerPriceBase` (±20%). Internal cost không bao giờ xuất hiện trong response API trả về cho customer.

**Validates: Requirements 8.2, 8.3**

### Property 8: AITask State Machine Không Bỏ Qua Trạng Thái

*For any* AITask và bất kỳ cặp `(fromStatus, toStatus)` nào, `StateMachineService.transition(task, toStatus)` chỉ thành công khi `toStatus ∈ VALID_TRANSITIONS[fromStatus]`. Mọi transition không hợp lệ phải throw exception và không thay đổi trạng thái trong DB.

**Validates: Requirements 10.1, 10.3**

### Property 9: CodingAgent Chỉ Thay Đổi File Trong Approved Plan

*For any* CodingAgent execution với `ImplementationPlan P`, tập hợp các file được thay đổi trong sandbox phải là tập con của `{step.filePath | step ∈ P.steps}`. Không một file nào nằm ngoài danh sách approved được tạo, sửa hoặc xóa.

**Validates: Requirements 11.2**

### Property 10: Branch Name Theo Convention

*For any* `issueId` và `title`, `generateBranchName(issueId, title)` phải trả về chuỗi khớp regex `/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/` và không bao giờ push lên nhánh mặc định của repo.

**Validates: Requirements 13.2**

### Property 11: ActivityLog Luôn Có Đủ Required Metadata

*For any* `ActivityLog` entry được tạo bởi bất kỳ sự kiện nào, entry đó phải chứa tất cả các field không null: `organizationId`, `eventType`, `friendlyMessage`, `createdAt`. Mọi log của AITask phải có `taskId` và `projectId`.

**Validates: Requirements 17.3**

### Property 12: Usage Aggregation Nhất Quán

*For any* organization và khoảng thời gian tháng/năm, tổng `customerCost` của tất cả `AITask` hoàn thành trong khoảng đó phải bằng `Usage.customerCost` cho tháng đó (±0.01 USD để tránh floating point error).

**Validates: Requirements 18.1**

### Property 13: ImplementationPlan Schema Validation Round-Trip

*For any* JSON object được AI trả về cho `PlanningAgent`, nếu object đó pass `ImplementationPlanSchema.parse()`, thì serialize lại rồi parse lần 2 phải cho kết quả tương đương (idempotent). Object không pass schema phải throw `ZodError` ngay lập tức.

**Validates: Requirements 7.4, 21.4**

### Property 14: Error Response Không Chứa Thông Tin Kỹ Thuật Nội Bộ

*For any* exception xảy ra trong bất kỳ API endpoint nào, response body trả về cho client không được chứa: stack trace, SQL error message, internal file path, hoặc tên bảng cơ sở dữ liệu. Response phải có `message` thân thiện với người dùng.

**Validates: Requirements 20.1**

### Property 15: Issue Description Validation

*For any* chuỗi `description`, `IssueService.create({description})` phải thành công khi và chỉ khi `10 <= description.trim().length <= 5000`. Mọi description ngắn hơn 10 ký tự sau trim phải bị từ chối với lỗi 400.

**Validates: Requirements 6.1**

### Property 16: Queue Retry Delay Theo Exponential Backoff

*For any* job thất bại lần thứ N (N ∈ {1, 2, 3}), delay trước lần thử tiếp theo phải là: N=1 → 30s, N=2 → 120s (2min), N=3 → 600s (10min). Sau 3 lần thất bại, job không được retry thêm.

**Validates: Requirements 19.3**

---

## Error Handling

### Global Exception Filter

```typescript
// src/common/filters/global-exception.filter.ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Log full technical details internally
    this.logger.error({
      exception: exception instanceof Error ? exception.stack : exception,
      path: request.url,
      method: request.method,
      userId: request.user?.id,
      organizationId: request.user?.activeOrgId,
    });

    // Never expose internals to customer
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      return response.status(status).json({
        statusCode: status,
        message: this.getFriendlyMessage(exception),
        // Validation errors are structured but safe to expose
        errors: this.getValidationErrors(exceptionResponse),
        timestamp: new Date().toISOString(),
      });
    }

    // Unexpected errors → generic 500
    return response.status(500).json({
      statusCode: 500,
      message: 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ hỗ trợ.',
      timestamp: new Date().toISOString(),
    });
  }

  private getFriendlyMessage(exception: HttpException): string {
    const FRIENDLY_MESSAGES: Record<number, string> = {
      400: 'Thông tin không hợp lệ. Vui lòng kiểm tra lại.',
      401: 'Bạn cần đăng nhập để thực hiện thao tác này.',
      403: 'Bạn không có quyền thực hiện thao tác này.',
      404: 'Không tìm thấy thông tin yêu cầu.',
      429: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    };
    return FRIENDLY_MESSAGES[exception.getStatus()] ?? exception.message;
  }
}
```

### AITask Failure Messages

```typescript
// Customer-friendly failure messages per state
const FAILURE_MESSAGES: Record<string, string> = {
  ANALYZING:    'AI không thể phân tích yêu cầu của bạn. Vui lòng kiểm tra lại mô tả và thử lại.',
  CODING:       'AI gặp lỗi khi viết code. Kế hoạch đã được lưu — bạn có thể thử lại.',
  TESTING:      'Code thay đổi không vượt qua được các bài kiểm tra. AI đã cố gắng sửa nhưng không thành công.',
  CREATING_PR:  'Không thể tạo Pull Request. Vui lòng kiểm tra kết nối GitHub và thử lại.',
};
```

---

## Testing Strategy

### Tổng Quan Phân Tầng Test

```
┌──────────────────────────────────────────────┐
│         Property-Based Tests (PBT)           │  ~35% coverage contribution
│  Thư viện: fast-check (TypeScript)           │
│  100+ iterations mỗi property                │
│  Các logic thuần túy: validators, scorers,   │
│  state machine, pricing, schema validation   │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│         Unit Tests (Jest)                    │  ~40% coverage contribution
│  Mỗi service method với mock dependencies    │
│  Happy path + error cases                    │
│  AI Agent logic với mocked AIProvider        │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│         Integration Tests (Jest + Testcontainers) │  ~20%
│  Real PostgreSQL + Redis in Docker           │
│  API endpoint → DB round trips               │
│  Queue worker end-to-end                     │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│         E2E Tests (Playwright)               │  ~5%
│  Critical user flows: register → create      │
│  project → create issue → approve → view PR  │
└──────────────────────────────────────────────┘
```

### Property-Based Test Implementation

Sử dụng **`fast-check`** — thư viện PBT cho TypeScript/JavaScript:

```bash
# Install
npm install --save-dev fast-check
```

#### Ví Dụ: Property 6 — Compatibility Score

```typescript
// test/unit/compatibility-scorer.property.spec.ts
import fc from 'fast-check';
import { CompatibilityScorerService } from '@/modules/projects/compatibility-scorer.service';

// Feature: ai-it-team-saas-mvp, Property 6: Compatibility score in [0,100] with correct tier
describe('CompatibilityScorerService - Properties', () => {
  const scorer = new CompatibilityScorerService();

  it('Property 6a: score is always in [0, 100]', () => {
    fc.assert(
      fc.property(
        fc.record({
          hasTests:      fc.boolean(),
          frameworks:    fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
          language:      fc.constantFrom('typescript', 'javascript', 'python', 'java', 'unknown'),
          hasDockerfile: fc.boolean(),
          hasCI:         fc.boolean(),
          complexityScore: fc.integer({ min: 0, max: 100 }),
        }),
        (analysisInput) => {
          const result = scorer.calculate(analysisInput);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 6b: tier classification is exhaustive and mutually exclusive', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const tier = scorer.classifyTier(score);
        const tiers = ['FULL_AI_SUPPORT', 'AI_ASSISTED', 'LIMITED_SUPPORT', 'UNSUPPORTED'];
        
        // Must be exactly one of the four tiers
        expect(tiers).toContain(tier);
        
        // Verify correct boundaries
        if (score >= 90) expect(tier).toBe('FULL_AI_SUPPORT');
        else if (score >= 70) expect(tier).toBe('AI_ASSISTED');
        else if (score >= 40) expect(tier).toBe('LIMITED_SUPPORT');
        else expect(tier).toBe('UNSUPPORTED');
      }),
      { numRuns: 500 },
    );
  });
});
```

#### Ví Dụ: Property 7 — Pricing Margin

```typescript
// test/unit/pricing.property.spec.ts
import fc from 'fast-check';
import { PricingService } from '@/modules/pricing/pricing.service';

// Feature: ai-it-team-saas-mvp, Property 7: Customer price >= internal cost
describe('PricingService - Properties', () => {
  const service = new PricingService();

  it('Property 7a: customer price always >= internal AI cost', () => {
    fc.assert(
      fc.property(
        fc.record({
          complexity:      fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
          estimatedTokens: fc.integer({ min: 100, max: 500_000 }),
          stepCount:       fc.integer({ min: 1, max: 50 }),
          riskLevel:       fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
          projectSizeKb:   fc.integer({ min: 10, max: 500_000 }),
        }),
        (input) => {
          const estimate = service.calculate(input);
          expect(estimate.customerPriceBase).toBeGreaterThan(estimate.internalAiCost);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 7b: variance is ±20% of base price', () => {
    fc.assert(
      fc.property(
        fc.record({
          complexity:      fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
          estimatedTokens: fc.integer({ min: 100, max: 100_000 }),
          stepCount:       fc.integer({ min: 1, max: 20 }),
          riskLevel:       fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
          projectSizeKb:   fc.integer({ min: 10, max: 100_000 }),
        }),
        (input) => {
          const estimate = service.calculate(input);
          const spread = estimate.customerPriceMax - estimate.customerPriceMin;
          const expectedSpread = estimate.customerPriceBase * 0.4;
          expect(spread).toBeCloseTo(expectedSpread, 2);
        },
      ),
      { numRuns: 200 },
    );
  });
});
```

#### Ví Dụ: Property 8 — State Machine

```typescript
// test/unit/state-machine.property.spec.ts
import fc from 'fast-check';
import { StateMachineService, VALID_TRANSITIONS } from '@/modules/ai-tasks/state-machine.service';

// Feature: ai-it-team-saas-mvp, Property 8: State machine rejects invalid transitions
describe('StateMachineService - Properties', () => {
  const sm = new StateMachineService();
  const allStates = Object.keys(VALID_TRANSITIONS);

  it('Property 8a: valid transitions always succeed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allStates).chain((fromState) => {
          const validTargets = VALID_TRANSITIONS[fromState];
          if (validTargets.length === 0) return fc.constant({ from: fromState, to: null });
          return fc.constantFrom(...validTargets).map(to => ({ from: fromState, to }));
        }),
        ({ from, to }) => {
          if (!to) return; // Terminal state — skip
          expect(() => sm.assertValidTransition(from, to)).not.toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 8b: invalid transitions always throw', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allStates),
        fc.constantFrom(...allStates),
        (fromState, toState) => {
          const isValid = VALID_TRANSITIONS[fromState]?.includes(toState);
          if (isValid) return; // Skip valid transitions
          
          expect(() => sm.assertValidTransition(fromState, toState)).toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
});
```

#### Ví Dụ: Property 13 — ImplementationPlan Schema

```typescript
// test/unit/implementation-plan.property.spec.ts
import fc from 'fast-check';
import { ImplementationPlanSchema } from '@/ai/schemas/implementation-plan.schema';

// Feature: ai-it-team-saas-mvp, Property 13: ImplementationPlan parse is idempotent
const planArbitrary = fc.record({
  summary:          fc.string({ minLength: 1 }),
  steps: fc.array(
    fc.record({
      order:        fc.integer({ min: 1, max: 100 }),
      type:         fc.constantFrom('CREATE', 'MODIFY', 'DELETE'),
      filePath:     fc.string({ minLength: 1 }),
      description:  fc.string({ minLength: 1 }),
      testRequired: fc.boolean(),
    }),
    { minLength: 1 },
  ),
  testsToWrite:     fc.array(fc.string()),
  rollbackStrategy: fc.string({ minLength: 1 }),
  estimatedMinutes: fc.integer({ min: 1, max: 480 }),
  complexityLevel:  fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
});

describe('ImplementationPlanSchema - Properties', () => {
  it('Property 13: parse is idempotent for valid plans', () => {
    fc.assert(
      fc.property(planArbitrary, (plan) => {
        const parsed1 = ImplementationPlanSchema.parse(plan);
        const parsed2 = ImplementationPlanSchema.parse(parsed1);
        expect(parsed2).toEqual(parsed1);
      }),
      { numRuns: 200 },
    );
  });
});
```

### Unit Test Focus Areas

```
- AuthService: login/register/refresh/logout với mocked Prisma + bcrypt
- PricingService: edge cases — zero tokens, critical complexity
- GitHubService: token encryption/decryption round trip
- ActivityLogService: metadata completeness for each event type
- IssueService: rate limiting logic, org validation
- ApprovalService: expiry logic, reminder scheduling
```

### Integration Tests (với Testcontainers)

```typescript
// test/integration/issues.integration.spec.ts
// Spin up real PostgreSQL container, run Prisma migrations,
// test full API flow: authenticate → create org → create project → create issue
```

### E2E Test (Playwright)

```
Flows cần cover:
1. Register → Verify Email → Login
2. Create Organization → Invite Member
3. Install GitHub App → Connect Repository → Wait for Analysis
4. Create Issue → View Plan → Approve → Track Task Progress
5. View Pull Request → Usage Dashboard
```

### Test Configuration

```json
// jest.config.js
{
  "testEnvironment": "node",
  "coverageThreshold": {
    "global": {
      "branches": 70,
      "functions": 80,
      "lines": 80
    }
  },
  "projects": [
    { "displayName": "unit",        "testMatch": ["**/test/unit/**/*.spec.ts"] },
    { "displayName": "property",    "testMatch": ["**/test/unit/**/*.property.spec.ts"] },
    { "displayName": "integration", "testMatch": ["**/test/integration/**/*.spec.ts"] }
  ]
}
```

---

## Frontend Component Patterns

### Live Task Status Polling

```typescript
// src/lib/hooks/use-live-task.ts
const ACTIVE_STATUSES = ['QUEUED', 'ANALYZING', 'PLANNING', 'PREPARING', 'CODING', 'TESTING', 'FIXING', 'REVIEWING', 'CREATING_PR'];

export function useLiveTask(taskId: string) {
  const [task, setTask] = useState<AITask | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchTask = async () => {
      const data = await aiTasksApi.getById(taskId);
      setTask(data);

      if (!ACTIVE_STATUSES.includes(data.status)) {
        clearInterval(interval); // Stop polling when terminal state
      }
    };

    fetchTask();
    interval = setInterval(fetchTask, 10_000); // Poll every 10s

    return () => clearInterval(interval);
  }, [taskId]);

  return task;
}
```

### API Client với Token Refresh

```typescript
// src/lib/api/client.ts
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach access token
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handle 401 → refresh token
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshed = await authApi.refresh();
      if (refreshed) {
        // Retry original request with new token
        return apiClient(error.config);
      }
      // Refresh failed → redirect to login
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);
```

---

## Environment Variables

```bash
# webwow-be/.env.example

# App
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3001

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/webwow

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-64-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-64-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# AI Provider
AI_PROVIDER=openai           # openai | anthropic
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
AI_DEFAULT_MODEL=gpt-4o

# GitHub App
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret
ENCRYPTION_KEY=your-32-byte-hex-encryption-key-for-tokens

# Redis
REDIS_URL=redis://localhost:6379

# Email
EMAIL_PROVIDER=resend         # resend | smtp
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourplatform.com

# Limits
MAX_CONCURRENT_CODING_TASKS=5
SANDBOX_CPU_LIMIT=2
SANDBOX_MEMORY_LIMIT=4g
SANDBOX_DISK_LIMIT=10g
SANDBOX_TIMEOUT_MINUTES=30
```

---

## Tóm Tắt Kế Hoạch Triển Khai

### Sprint 1 (Tuần 1–2): Foundation
- Setup NestJS project, Prisma, PostgreSQL, Redis
- Auth module: register, login, JWT, bcrypt
- Organization module: create, invite, roles
- Base middleware: global exception filter, logging, rate limiter

### Sprint 2 (Tuần 3–4): GitHub + Projects
- GitHub App integration, Octokit, webhook
- Project module, connect repo
- ProjectAnalyzer worker (BullMQ)
- CompatibilityScorer logic

### Sprint 3 (Tuần 5–6): AI Core
- AIProvider interface, OpenAI + Anthropic adapters
- Prompt classes, JSON schema validation
- AIAnalysisAgent + PlanningAgent workers
- PricingService, CostEstimate

### Sprint 4 (Tuần 7–8): Approval + Execution
- ApprovalService, approval/rejection flow
- AITask state machine
- CodingAgent, SandboxExecutor (Docker)
- PR creation via GitHub API

### Sprint 5 (Tuần 9–10): Frontend
- Next.js app shell, auth pages
- Dashboard, Projects, Issues pages
- Issue detail với live polling
- Activity log viewer, Usage dashboard

### Sprint 6 (Tuần 11–12): Polish + Testing
- Property-based tests cho tất cả core services
- Integration tests với Testcontainers
- Performance optimization, index tuning
- OpenAPI docs, error message review
