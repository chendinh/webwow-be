# Bugfix Requirements Document

## Introduction

The `GET /api/projects` endpoint (and all other `/api/projects/*` routes) returns a 404 error for all requests. The root cause is a double `api` prefix: `main.ts` registers a global prefix of `api` via `app.setGlobalPrefix('api')`, while `ProjectsController` is decorated with `@Controller('api/projects')`. NestJS combines both, making the real route `/api/api/projects`. Any client calling the documented `/api/projects` path will always get a 404. This bug affects every route in `ProjectsController` (list, detail, create, update, delete, analysis, health-check, reanalyze, deploy-to-main).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a client sends `GET /api/projects?organizationId=<id>` THEN the system returns HTTP 404 with message "Cannot GET /api/projects?organizationId=<id>"

1.2 WHEN a client sends `GET /api/projects/:projectId` THEN the system returns HTTP 404 because the controller path resolves to `/api/api/projects/:projectId`

1.3 WHEN a client sends `POST /api/projects` THEN the system returns HTTP 404 because the actual registered route is `/api/api/projects`

1.4 WHEN a client sends `PATCH /api/projects/:projectId` THEN the system returns HTTP 404 because the route is doubled

1.5 WHEN a client sends `DELETE /api/projects/:projectId` THEN the system returns HTTP 404 because the route is doubled

1.6 WHEN a client sends `GET /api/projects/:projectId/analysis` THEN the system returns HTTP 404 because the route is doubled

1.7 WHEN a client sends `POST /api/projects/:projectId/reanalyze` THEN the system returns HTTP 404 because the route is doubled

1.8 WHEN a client sends `POST /api/projects/:projectId/health-check` THEN the system returns HTTP 404 because the route is doubled

1.9 WHEN a client sends `GET /api/projects/:projectId/health-check` THEN the system returns HTTP 404 because the route is doubled

1.10 WHEN a client sends `POST /api/projects/:projectId/deploy-to-main` THEN the system returns HTTP 404 because the route is doubled

### Expected Behavior (Correct)

2.1 WHEN a client sends `GET /api/projects?organizationId=<id>` THEN the system SHALL return HTTP 200 with the list of projects for the given organization

2.2 WHEN a client sends `GET /api/projects/:projectId` THEN the system SHALL return HTTP 200 with the project detail (or 404 if the project does not exist in the database)

2.3 WHEN a client sends `POST /api/projects` THEN the system SHALL return HTTP 201 with the newly created project

2.4 WHEN a client sends `PATCH /api/projects/:projectId` THEN the system SHALL return HTTP 200 with the updated project

2.5 WHEN a client sends `DELETE /api/projects/:projectId` THEN the system SHALL return HTTP 204

2.6 WHEN a client sends `GET /api/projects/:projectId/analysis` THEN the system SHALL return HTTP 200 with the analysis result or null

2.7 WHEN a client sends `POST /api/projects/:projectId/reanalyze` THEN the system SHALL return HTTP 204 and enqueue a re-analysis job

2.8 WHEN a client sends `POST /api/projects/:projectId/health-check` THEN the system SHALL return HTTP 204 and enqueue a health-check job

2.9 WHEN a client sends `GET /api/projects/:projectId/health-check` THEN the system SHALL return HTTP 200 with the latest health-check result

2.10 WHEN a client sends `POST /api/projects/:projectId/deploy-to-main` THEN the system SHALL return HTTP 200 with the pull request URL and number

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a client calls any route in `AuthModule` (e.g., `POST /api/auth/login`) THEN the system SHALL CONTINUE TO route the request correctly without any change in behavior

3.2 WHEN a client calls any route in `OrganizationsModule` (e.g., `GET /api/organizations`) THEN the system SHALL CONTINUE TO route the request correctly

3.3 WHEN a client calls any route in `IssuesModule` (e.g., `GET /api/issues`) THEN the system SHALL CONTINUE TO route the request correctly

3.4 WHEN a client calls any route in `GithubModule` THEN the system SHALL CONTINUE TO route the request correctly

3.5 WHEN the `JwtAuthGuard` is active on a projects endpoint THEN the system SHALL CONTINUE TO reject unauthenticated requests with HTTP 401

3.6 WHEN a request is made to a projects endpoint with a valid JWT but for a different organization's project THEN the system SHALL CONTINUE TO return HTTP 404 (multi-tenant isolation is preserved)

3.7 WHEN `GET /api/docs` (Swagger UI) is accessed THEN the system SHALL CONTINUE TO serve the documentation correctly

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type HttpRequest
  OUTPUT: boolean

  // Returns true when the request targets any /api/projects route
  RETURN X.path STARTS_WITH "/api/projects"
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: Fix Checking — Projects routes resolve correctly after fix
FOR ALL X WHERE isBugCondition(X) DO
  response ← ProjectsController'(X)
  ASSERT response.statusCode ≠ 404 due to routing
  ASSERT response.statusCode IN {200, 201, 204, 400, 401, 403, 404_data}
END FOR
```

> Note: `404_data` refers to a 404 returned because the requested project does not exist in the database, which is correct behavior — not a routing 404.

### Property: Preservation Checking

```pascal
// Property: Preservation Checking — non-projects routes are unaffected
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)   // behavior identical before and after fix
END FOR
```
