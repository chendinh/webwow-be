# Implementation Plan

## Overview

Fix the double `api` prefix bug in `ProjectsController` using the exploratory bugfix workflow: write tests before the fix to confirm the bug and establish a preservation baseline, apply the single-line change, then validate both fix-checking and preservation properties.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3.1"] },
    { "wave": 4, "tasks": ["3.2", "3.3"] },
    { "wave": 5, "tasks": ["4"] }
  ]
}
```

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Projects Routes Return 404 on Unfixed Code
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the double-prefix bug
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases — all HTTP methods on `/api/projects` paths
  - Create a NestJS `supertest` integration test that spins up the test application with the **unfixed** `@Controller('api/projects')` decorator
  - Test that `GET /api/projects?organizationId=x` with a valid JWT returns a routing 404 (confirms double prefix bug)
  - Test that `POST /api/projects` with valid body and JWT returns a routing 404
  - Test that `GET /api/projects/:projectId?organizationId=x` with valid JWT returns a routing 404
  - Test that `GET /api/api/projects?organizationId=x` (doubled path) is reachable and returns a non-404 response on unfixed code — this confirms the root cause
  - Run test on UNFIXED code (controller still has `@Controller('api/projects')`)
  - **EXPECTED OUTCOME**: Tests for `/api/projects` FAIL (correct — proves the bug exists); doubled-path test passes
  - Document counterexamples found (e.g., `GET /api/projects?organizationId=org-1` → 404 "Cannot GET /api/projects")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Projects Routes Are Unaffected by the Fix
  - **IMPORTANT**: Follow observation-first methodology — observe actual responses on unfixed code first
  - Observe: `POST /api/auth/login` with correct credentials returns current status on unfixed code
  - Observe: `GET /api/organizations` with valid JWT returns current status on unfixed code
  - Observe: `GET /api/issues` with valid JWT returns current status on unfixed code
  - Observe: `GET /api/docs` returns 200 with HTML on unfixed code
  - Observe: `GET /api/projects/any-id` without a JWT returns 401 on unfixed code (guard still active, 401 returned before routing check)
  - Write property-based tests that assert for all inputs `X` where `isBugCondition(X)` is false (`X.path` does NOT start with `/api/projects`), the server response is identical before and after the fix
  - Cover: auth routes, organizations routes, issues routes, Swagger docs route, and unauthenticated projects requests (401 from JWT guard)
  - Verify all preservation tests PASS on UNFIXED code before proceeding
  - **EXPECTED OUTCOME**: Tests PASS on unfixed code (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix for double `api` prefix in ProjectsController

  - [x] 3.1 Implement the fix
    - In `src/modules/projects/projects.controller.ts`, change the class-level decorator from `@Controller('api/projects')` to `@Controller('projects')`
    - NestJS will then combine the global prefix `api` (from `main.ts`) with the controller prefix `projects` to produce the correct effective path `/api/projects`
    - Do NOT modify `main.ts` or any other file — this is a single-line change
    - Confirm no other controller in the codebase carries an `api/` prefix (they all use bare resource names)
    - _Bug_Condition: isBugCondition(X) where X.path STARTS_WITH "/api/projects"_
    - _Expected_Behavior: response.statusCode IN {200, 201, 204, 400, 401, 403, 404_data} — never a routing 404_
    - _Preservation: All requests where isBugCondition(X) is false must produce identical responses before and after the fix_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Projects Routes Resolve Correctly After Fix
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (non-routing-404 status codes for all `/api/projects` requests)
    - When this test passes, it confirms the fixed controller is reachable at `/api/projects`
    - Verify `GET /api/projects?organizationId=x` no longer returns a routing 404 — returns 200, 400, or 401 depending on auth/data
    - Verify `POST /api/projects`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id` are all reachable
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Projects Behavior Unchanged After Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2 against the fixed code
    - Confirm auth, organizations, issues, Swagger, and JWT guard behavior is identical to the baseline observed in task 2
    - Confirm unauthenticated requests to `/api/projects/*` still return 401
    - Confirm multi-tenant isolation still returns data-driven 404 for cross-organization access
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions introduced by the fix)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`npm run test` or `npm run test:e2e`) and confirm all tests pass
  - Confirm Property 1 (bug condition exploration test) now passes — routing 404s are gone
  - Confirm Property 2 (preservation tests) still passes — no regressions
  - If any test fails, diagnose before proceeding; ask the user if questions arise

## Notes

- The fix is a single-line change: `@Controller('api/projects')` → `@Controller('projects')` in `src/modules/projects/projects.controller.ts`
- Do NOT modify `main.ts` — the global prefix `api` must remain unchanged
- Tasks 1 and 2 MUST be completed on unfixed code before applying the change in task 3.1
- Property-based testing is used for preservation because it provides stronger guarantees across the full input domain (all non-projects paths) compared to hand-picked examples
