import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { GithubService } from './github.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Webhook Payload Types ───────────────────────────────────────────────────

interface InstallationAccount {
  id?: number;
  login?: string;
}

interface InstallationPayload {
  action: 'created' | 'deleted' | string;
  installation: {
    id: number;
    account?: InstallationAccount;
  };
}

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    merged: boolean;
    base: {
      repo: {
        owner: { login: string };
        name: string;
      };
    };
  };
  installation?: {
    id: number;
  };
}

// ─── Controller ──────────────────────────────────────────────────────────────

/**
 * Handles inbound GitHub App webhook events.
 *
 * Security note: signature verification happens BEFORE any payload processing
 * to prevent attackers from triggering business logic with forged payloads.
 */
@Controller('github/webhooks')
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /api/github/webhooks
   *
   * Receives GitHub App webhook events. Raw body is required for HMAC-SHA256
   * signature verification — NestJS exposes it via `req.rawBody` when the app
   * is bootstrapped with `rawBody: true`.
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-github-event') eventType: string,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<void> {
    // ── 1. Signature verification (must be first) ──────────────────────────

    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body);

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const isValid = this.githubService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // ── 2. Parse body ──────────────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const payload = req.body as Record<string, unknown>;

    this.logger.log(`GitHub webhook received: ${eventType}`);

    // ── 3. Route to handler ────────────────────────────────────────────────

    switch (eventType) {
      case 'installation':
        await this.handleInstallationEvent(payload as unknown as InstallationPayload);
        break;

      case 'pull_request':
        await this.handlePullRequestEvent(payload as unknown as PullRequestPayload);
        break;

      default:
        // GitHub expects 200 for all valid events, even unhandled ones
        this.logger.debug(`Unhandled GitHub event type: ${eventType}`);
        break;
    }
  }

  // ── Event Handlers ────────────────────────────────────────────────────────

  /**
   * Handles `installation.created` and `installation.deleted` events.
   * Updates the GitHubInstallation record accordingly.
   */
  private async handleInstallationEvent(
    payload: InstallationPayload,
  ): Promise<void> {
    const { action, installation } = payload;
    const installationId = String(installation.id);

    if (action === 'created') {
      this.logger.log(`GitHub App installed: installationId=${installationId}`);
      // The full upsert is handled via the OAuth callback flow in github.service.ts.
      // Here we just log; the record is created when the user completes the install flow.
    } else if (action === 'deleted') {
      this.logger.log(`GitHub App uninstalled: installationId=${installationId}`);

      // Remove the installation record when the app is uninstalled
      await this.prisma.gitHubInstallation.deleteMany({
        where: { installationId },
      });
    }
  }

  /**
   * Handles `pull_request` events.
   * On close + merged  → set PullRequest status to MERGED.
   * On close + !merged → set PullRequest status to CLOSED.
   */
  private async handlePullRequestEvent(
    payload: PullRequestPayload,
  ): Promise<void> {
    const { action, pull_request: pr } = payload;

    if (action !== 'closed') {
      // Only interested in closed events
      return;
    }

    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;
    const prNumber = pr.number;
    const isMerged = pr.merged;

    const newStatus = isMerged ? 'MERGED' : 'CLOSED';

    this.logger.log(
      `PR #${prNumber} closed in ${owner}/${repo} — status: ${newStatus}`,
    );

    // Find the PullRequest record by GitHub PR number and update its status
    await this.prisma.pullRequest.updateMany({
      where: {
        githubPrNumber: prNumber,
        // Match by project's repo details via project relation
        project: {
          githubRepoFullName: `${owner}/${repo}`,
        },
      },
      data: {
        status: newStatus,
        ...(newStatus === 'MERGED' ? { mergedAt: new Date() } : {}),
        ...(newStatus === 'CLOSED' ? { closedAt: new Date() } : {}),
      },
    });
  }
}
