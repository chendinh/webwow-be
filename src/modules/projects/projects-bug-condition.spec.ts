/**
 * Bug Condition Exploration Test — Task 1
 *
 * PURPOSE: Confirm the double-prefix bug exists on UNFIXED code.
 *
 * ROOT CAUSE:
 *   - main.ts sets app.setGlobalPrefix('api')
 *   - ProjectsController is decorated with @Controller('api/projects')
 *   - NestJS concatenates them → real route is /api/api/projects
 *   - Any client calling /api/projects always gets routing 404
 *
 * EXPECTED OUTCOME (on UNFIXED code):
 *   - Tests for /api/projects FAIL  → confirms the bug exists
 *   - Test for /api/api/projects PASSES → confirms the doubled path is the root cause
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 *
 * NOTE: This test encodes EXPECTED behavior. After the fix (@Controller('projects')),
 * all /api/projects assertions will pass, validating Requirements 2.1–2.10.
 */

// Mock heavy ESM dependencies before any imports — prevents the github/octokit chain
// from being loaded (they are not relevant to routing tests)
jest.mock('../github/github.service');
jest.mock('../../queue/queue.service');
jest.mock('../../prisma/prisma.service');

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import * as request from 'supertest';

import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// ── Stub guard — always authenticates, so routing (not auth) is what we observe ──

class AlwaysAuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

// ── Minimal stub service — returns empty/dummy values so the controller can respond ──

const stubProjectsService = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
  findById: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
  update: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Updated' }),
  softDelete: jest.fn().mockResolvedValue(undefined),
  getAnalysis: jest.fn().mockResolvedValue(null),
  reanalyze: jest.fn().mockResolvedValue(undefined),
  triggerHealthCheck: jest.fn().mockResolvedValue(undefined),
  getHealthCheck: jest.fn().mockResolvedValue({ status: null, result: null, checkedAt: null }),
  deployToMain: jest.fn().mockResolvedValue({ prUrl: 'https://github.com/pr/1', prNumber: 1 }),
};

// ── Test app bootstrap ──────────────────────────────────────────────────────────

async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [ProjectsController],
    providers: [
      { provide: ProjectsService, useValue: stubProjectsService },
    ],
  })
    // Override the real JwtAuthGuard with the always-passing stub
    .overrideGuard(JwtAuthGuard)
    .useClass(AlwaysAuthGuard)
    .compile();

  const app = moduleRef.createNestApplication();

  // Replicate main.ts global prefix — this is the key that causes the double-prefix bug
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // lenient for routing tests
    }),
  );

  await app.init();
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration — Double Prefix in ProjectsController (UNFIXED)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Counterexample 1: GET /api/projects ────────────────────────────────────
  /**
   * Validates: Requirement 1.1
   * BUG: Controller registered at /api/api/projects, so /api/projects returns routing 404.
   * EXPECTED BEHAVIOR (after fix): Returns 200 with project list.
   * COUNTEREXAMPLE: GET /api/projects?organizationId=org-1 → 404 "Cannot GET /api/projects"
   */
  it('GET /api/projects?organizationId=x — should return 200 with project list (NOT a routing 404)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/projects')
      .query({ organizationId: 'org-1' });

    // This assertion FAILS on unfixed code (404 received), proving the bug.
    // It will PASS after the fix, validating Requirement 2.1.
    expect(response.status).not.toBe(404);
    expect([200, 201, 400, 401]).toContain(response.status);
  });

  // ── Counterexample 2: POST /api/projects ───────────────────────────────────
  /**
   * Validates: Requirement 1.3
   * BUG: POST /api/projects returns 404 — route not registered.
   * COUNTEREXAMPLE: POST /api/projects with body → 404 "Cannot POST /api/projects"
   */
  it('POST /api/projects — should return 201 with created project (NOT a routing 404)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/projects')
      .send({
        name: 'Test Project',
        githubRepoFullName: 'org/repo',
        githubInstallationId: 'inst-1',
      });

    // This assertion FAILS on unfixed code, proving the bug.
    // It will PASS after the fix, validating Requirement 2.3.
    expect(response.status).not.toBe(404);
    expect([200, 201, 400, 401]).toContain(response.status);
  });

  // ── Counterexample 3: GET /api/projects/:projectId ────────────────────────
  /**
   * Validates: Requirement 1.2
   * BUG: GET /api/projects/:projectId returns 404 — route not registered.
   * COUNTEREXAMPLE: GET /api/projects/proj-abc?organizationId=org-1 → 404
   */
  it('GET /api/projects/:projectId?organizationId=x — should return 200 (NOT a routing 404)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/projects/proj-abc')
      .query({ organizationId: 'org-1' });

    // This assertion FAILS on unfixed code, proving the bug.
    // It will PASS after the fix, validating Requirement 2.2.
    expect(response.status).not.toBe(404);
    expect([200, 201, 400, 401]).toContain(response.status);
  });

  // ── Root Cause Confirmation: GET /api/api/projects ────────────────────────
  /**
   * ROOT CAUSE CONFIRMATION:
   * The actually registered route on UNFIXED code is /api/api/projects (doubled prefix).
   * This test confirms the root cause by asserting the doubled path IS reachable.
   *
   * On UNFIXED code  → this returns non-404 (controller is reached at /api/api/projects)
   * After the fix    → this returns 404 (the doubled path is no longer registered)
   *
   * Note: On unfixed code this PASSES. After the fix, it will FAIL (doubled path gone).
   * This is intentional — it documents the root cause, not the desired behavior.
   */
  it('GET /api/api/projects?organizationId=x — doubled path SHOULD be reachable on unfixed code (confirms root cause)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/api/projects')
      .query({ organizationId: 'org-1' });

    // On UNFIXED code: this PASSES (route is reachable at the doubled path)
    // Confirming the root cause: NestJS concatenated 'api' + 'api/projects' = /api/api/projects
    expect(response.status).not.toBe(404);
    expect([200, 201, 400, 401]).toContain(response.status);
  });
});
