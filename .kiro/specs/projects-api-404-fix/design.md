# Projects API 404 Fix — Bugfix Design

## Overview

All routes under `ProjectsController` return HTTP 404 for every request because NestJS
combines the global prefix `api` (set in `main.ts` via `app.setGlobalPrefix('api')`) with
the controller-level prefix `api/projects` (declared as `@Controller('api/projects')`),
producing the doubled path `/api/api/projects`. Any client targeting the documented
`/api/projects` path never reaches the controller.

The fix is a single-line change: replace `@Controller('api/projects')` with
`@Controller('projects')` in `src/modules/projects/projects.controller.ts`. After the
fix, NestJS constructs the correct path `/api/projects` for every route in the controller.
No other file requires modification.

## Glossary

- **Bug_Condition (C)**: An HTTP request whose path starts with `/api/projects` — these
  requests currently resolve to 404 due to the doubled prefix.
- **Property (P)**: The desired behavior once the fix is applied — any request matching C
  reaches `ProjectsController` and receives the correct HTTP status code (200, 201, 204,
  400, 401, or a data-driven 404), never a routing 404.
- **Preservation**: All behavior unrelated to `ProjectsController` routing — other modules,
  JWT guard, Swagger UI, multi-tenant isolation — must remain identical before and after
  the fix.
- **Global Prefix**: The `api` string registered in `main.ts` via `app.setGlobalPrefix('api')`.
  NestJS prepends this to every controller path automatically.
- **Controller Prefix**: The string passed to `@Controller(...)`. NestJS appends it to the
  global prefix when building the full route.
- **`ProjectsController`**: The class in `src/modules/projects/projects.controller.ts` that
  handles all `/api/projects` CRUD and sub-resource routes.
- **`isBugCondition(X)`**: Pseudocode predicate — returns `true` when request `X` targets
  any path under `/api/projects`.

## Bug Details

### Bug Condition

The bug manifests for every HTTP request whose path begins with `/api/projects`. Because
the controller prefix `api/projects` is combined with the global prefix `api`, NestJS
registers all routes under `/api/api/projects`. The correctly documented path
`/api/projects` is never registered, so every request returns a routing 404.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT:  X of type HttpRequest
  OUTPUT: boolean

  RETURN X.path STARTS_WITH "/api/projects"
END FUNCTION
```

### Examples

- `GET /api/projects?organizationId=org-1` → HTTP 404 "Cannot GET /api/projects"
  (expected: 200 with project list or 401 if unauthenticated)
- `POST /api/projects` with valid body and JWT → HTTP 404
  (expected: 201 with created project)
- `GET /api/projects/proj-abc?organizationId=org-1` with valid JWT → HTTP 404
  (expected: 200 with project detail)
- `GET /api/api/projects` (the actually registered path) → reaches the controller
  but is an undocumented, incorrect URL that no client should use

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- All routes in `AuthModule` (e.g. `POST /api/auth/login`) MUST continue to work
  exactly as before — the change touches only `ProjectsController`.
- All routes in `OrganizationsModule`, `IssuesModule`, `GithubModule`,
  `ApprovalsModule`, `NotificationsModule`, `PricingModule`, `UsageModule`,
  `SystemHealthModule`, `ActivityModule`, and `AiTasksModule` MUST be unaffected.
- `JwtAuthGuard` MUST continue to reject unauthenticated requests to projects
  endpoints with HTTP 401.
- Multi-tenant isolation MUST be preserved: a valid JWT for organization A MUST NOT
  grant access to organization B's projects (data-driven 404 still returned).
- Swagger UI at `GET /api/docs` MUST continue to serve documentation correctly.
- The global prefix configuration in `main.ts` MUST NOT be modified.

**Scope:**

All inputs that do NOT satisfy `isBugCondition(X)` — i.e. every request not targeting
`/api/projects` — must be completely unaffected by this fix. This includes:

- All other module routes
- Non-HTTP operations (queue jobs, Prisma calls, etc.)
- Swagger setup and Helmet middleware

## Hypothesized Root Cause

There is only one root cause, confirmed by direct code inspection:

1. **Double Prefix**: `main.ts` calls `app.setGlobalPrefix('api')`, which NestJS
   prepends to every controller path. `ProjectsController` is decorated with
   `@Controller('api/projects')`, which already contains the `api` segment. NestJS
   concatenates them to produce `/api/api/projects`. No request from clients using the
   documented `/api/projects` path ever hits the controller.

   Confirming evidence:
   - `src/main.ts` line: `app.setGlobalPrefix('api');`
   - `src/modules/projects/projects.controller.ts` line: `@Controller('api/projects')`

   No other controller in the codebase was observed to carry the `api/` prefix (they
   use bare resource names such as `organizations`, `auth`, `issues`), confirming this
   is an isolated typo in `ProjectsController`.

## Correctness Properties

Property 1: Bug Condition — Projects Routes Resolve After Fix

_For any_ HTTP request `X` where `isBugCondition(X)` is true (path starts with
`/api/projects`) and the server is running the fixed code, the NestJS router SHALL
successfully match the request to `ProjectsController` and return an HTTP status code
in the set `{200, 201, 204, 400, 401, 403, 404_data}` — never a routing 404 caused by
an unregistered path.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation — Non-Projects Behavior Unchanged

_For any_ HTTP request `X` where `isBugCondition(X)` is false (path does NOT start
with `/api/projects`), the fixed server SHALL produce exactly the same response as the
original server, preserving all routing, authentication, and business logic for every
other module and middleware.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

**File:** `src/modules/projects/projects.controller.ts`

**Function / Decorator:** `@Controller(...)` at class level

**Specific Change:**

```diff
- @Controller('api/projects')
+ @Controller('projects')
```

That is the only change needed. NestJS will then build:

```
global prefix  +  controller prefix  =  effective path
    api        +      projects       =  /api/projects   ✓
```

**No changes to:**

- `src/main.ts` — global prefix stays as `api`
- Any other controller — all other controllers already use bare resource names
- Any service, repository, DTO, guard, or module file

## Testing Strategy

### Validation Approach

Testing follows two phases: first run exploratory tests on the **unfixed** code to confirm
the bug and understand its exact shape, then run fix-checking and preservation tests on
the **fixed** code.

### Exploratory Bug Condition Checking

**Goal:** Surface concrete counterexamples on unfixed code to confirm the double-prefix
root cause.

**Test Plan:** Use NestJS `supertest` integration tests to fire HTTP requests against a
running test app instance and assert that `/api/projects` routes currently return 404.

**Test Cases:**

1. **List Projects 404**: `GET /api/projects?organizationId=x` with valid JWT →
   assert status 404 (will fail on unfixed code — confirms the bug)
2. **Create Project 404**: `POST /api/projects` with valid body and JWT →
   assert status 404 (will fail on unfixed code)
3. **Get Project 404**: `GET /api/projects/some-id?organizationId=x` with valid JWT →
   assert status 404 (will fail on unfixed code)
4. **Doubled Path Reachable**: `GET /api/api/projects?organizationId=x` with valid JWT →
   assert status 200 or 400 (should succeed on unfixed code, confirming doubled path)

**Expected Counterexamples:**

- All `/api/projects` requests return 404 on unfixed code
- The path `/api/api/projects` is the only reachable route on unfixed code

### Fix Checking

**Goal:** Verify that after the fix, every request matching `isBugCondition` is routed
correctly and returns an appropriate (non-routing-404) status.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  response := ProjectsController_fixed(X)
  ASSERT response.statusCode NOT IN {404_routing}
  ASSERT response.statusCode IN {200, 201, 204, 400, 401, 403, 404_data}
END FOR
```

### Preservation Checking

**Goal:** Verify that for all requests NOT matching `isBugCondition`, the fixed server
produces identical behavior to the original server.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F_original(X) = F_fixed(X)
END FOR
```

**Testing Approach:** Property-based testing is well-suited here because:

- It generates many varied request shapes automatically
- It provides confidence that no unrelated route is accidentally affected
- It documents the invariant explicitly for future regressions

**Test Cases:**

1. **Auth Routes Preserved**: `POST /api/auth/login` with correct and incorrect
   credentials — responses must be identical before and after fix
2. **Organizations Routes Preserved**: `GET /api/organizations` — status must be
   identical before and after fix
3. **Issues Routes Preserved**: `GET /api/issues` — status must be identical
4. **Swagger Preserved**: `GET /api/docs` returns 200 with HTML before and after fix
5. **JWT Guard Preserved**: Requests to `/api/projects/*` without a token still return
   401 after fix (guard still active)
6. **Multi-Tenant Isolation Preserved**: Project owned by org-A is not accessible with
   a token scoped to org-B (data-driven 404 still returned)

### Unit Tests

- Test that `ProjectsController` is decorated with `@Controller('projects')` (not
  `'api/projects'`) after the fix
- Test that the NestJS router registers routes under `/api/projects` when the global
  prefix is `api`
- Test edge cases: unauthenticated request returns 401, missing `organizationId`
  returns 400

### Property-Based Tests

- Generate random organization IDs and project IDs; assert that `GET /api/projects`
  with a valid JWT returns 200 or 404_data, never a routing 404
- Generate random non-projects paths; assert that the fixed server routes them
  identically to the original server (preservation property across the input domain)
- Test that all HTTP methods (GET, POST, PATCH, DELETE) on `/api/projects` routes are
  reachable and return method-appropriate status codes

### Integration Tests

- Full CRUD flow: create → list → get → update → delete a project via the API and
  verify correct status codes at each step
- Health-check and analysis sub-resource flows: trigger health-check, fetch result,
  trigger reanalyze, fetch analysis
- Context switching: verify that switching organizations within the same test session
  returns only the correct organization's projects
