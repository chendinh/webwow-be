import {
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@octokit/app';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OCTOKIT_APP } from './octokit.provider';

// ─── Response Types ─────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
}

// ─── GithubService ───────────────────────────────────────────────────────────

@Injectable()
export class GithubService {
  constructor(
    @Inject(OCTOKIT_APP) private readonly octokitApp: App,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ── Encryption / Decryption (AES-256-GCM) ──────────────────────────────

  /**
   * Encrypts a plaintext installation token.
   * Output format: iv_hex:authTag_hex:encrypted_hex
   */
  private encryptToken(plaintext: string): string {
    const encryptionKey =
      this.configService.get<string>('github.encryptionKey') ?? '';
    const derivedKey = crypto.scryptSync(encryptionKey, 'github-token-salt', 32);
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a ciphertext string produced by encryptToken.
   * Expected format: iv_hex:authTag_hex:encrypted_hex
   */
  private decryptToken(ciphertext: string): string {
    const encryptionKey =
      this.configService.get<string>('github.encryptionKey') ?? '';
    const derivedKey = crypto.scryptSync(encryptionKey, 'github-token-salt', 32);
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedData = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  // ── GitHub App Installation Management ────────────────────────────────

  /**
   * Returns the GitHub App installation URL so users can install the app
   * on their GitHub organisation or account.
   */
  getInstallUrl(): string {
    const appId = this.configService.get<string>('github.appId') ?? '';
    // GitHub App installation URL uses the app slug, which is derived from
    // the app name. We surface the appId here; callers should map it to
    // the app slug via env var (GITHUB_APP_NAME) if required.
    const appName =
      this.configService.get<string>('github.appName') ?? appId;
    return `https://github.com/apps/${appName}/installations/new`;
  }

  /**
   * Handles the OAuth callback after a user installs the GitHub App.
   * Fetches an installation access token, encrypts it, and upserts the
   * GitHubInstallation record for the given organisation.
   */
  async handleInstallationCallback(
    installationId: number,
    organizationId: string,
  ): Promise<void> {
    // Obtain an installation-scoped Octokit client
    const octokit = await this.octokitApp.getInstallationOctokit(installationId);

    // Retrieve installation details from GitHub
    const { data: installation } =
      await octokit.request('GET /app/installations/{installation_id}', {
        installation_id: installationId,
      });

    // Create an installation access token
    const { data: tokenData } = await octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      { installation_id: installationId },
    );

    const encryptedToken = this.encryptToken(tokenData.token);
    const tokenExpiresAt = tokenData.expires_at
      ? new Date(tokenData.expires_at)
      : null;

    const githubAccountId = String(installation.account?.id ?? '');
    const githubAccountLogin =
      'login' in (installation.account ?? {})
        ? ((installation.account as { login?: string }).login ?? '')
        : '';

    await this.prisma.gitHubInstallation.upsert({
      where: { organizationId },
      create: {
        organizationId,
        installationId: String(installationId),
        encryptedToken,
        tokenExpiresAt,
        githubAccountId,
        githubAccountLogin,
      },
      update: {
        installationId: String(installationId),
        encryptedToken,
        tokenExpiresAt,
        githubAccountId,
        githubAccountLogin,
      },
    });
  }

  /**
   * Returns the list of repositories accessible to the installation for the
   * given organisation. Must complete within 5 seconds per requirement R3.4.
   */
  async getRepositories(organizationId: string): Promise<GitHubRepo[]> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.request(
      'GET /installation/repositories',
      { per_page: 100 },
    );

    return data.repositories.map((repo) => ({
      id: Number(repo.id),
      fullName: repo.full_name,
      name: repo.name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      description: repo.description ?? null,
    }));
  }

  /**
   * Returns the list of branch names for the given repository.
   */
  async getBranches(
    organizationId: string,
    owner: string,
    repo: string,
  ): Promise<string[]> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/branches',
      { owner, repo, per_page: 100 },
    );

    return data.map((branch) => branch.name);
  }

  /**
   * Creates a new branch on the given repository, starting from `fromBranch`.
   */
  async createBranch(
    organizationId: string,
    owner: string,
    repo: string,
    branchName: string,
    fromBranch: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // Resolve the SHA of the source branch head
    const { data: ref } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      { owner, repo, ref: `heads/${fromBranch}` },
    );

    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });
  }

  /**
   * Returns the decrypted installation token for the given organisation.
   * Used by the CodingAgent to authenticate Git operations.
   */
  async getDecryptedToken(organizationId: string): Promise<string> {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { organizationId },
    });

    if (!installation) {
      throw new NotFoundException(
        `GitHub installation not found for organisation ${organizationId}`,
      );
    }

    // If token is expired, refresh it
    if (installation.tokenExpiresAt && installation.tokenExpiresAt < new Date()) {
      return this.refreshAndGetToken(installation.installationId, organizationId);
    }

    return this.decryptToken(installation.encryptedToken);
  }

  /**
   * Refreshes an expired installation token, persists the new encrypted value,
   * and returns the plaintext token.
   */
  private async refreshAndGetToken(
    installationId: string,
    organizationId: string,
  ): Promise<string> {
    const octokit = await this.octokitApp.getInstallationOctokit(
      Number(installationId),
    );
    const { data: tokenData } = await octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      { installation_id: Number(installationId) },
    );

    const encryptedToken = this.encryptToken(tokenData.token);
    const tokenExpiresAt = tokenData.expires_at
      ? new Date(tokenData.expires_at)
      : null;

    await this.prisma.gitHubInstallation.update({
      where: { organizationId },
      data: { encryptedToken, tokenExpiresAt },
    });

    return tokenData.token;
  }

  /**
   * Creates a pull request on the given repository.
   * Returns the PR number and HTML URL.
   */
  async createPullRequest(
    organizationId: string,
    owner: string,
    repo: string,
    params: {
      title: string;
      body: string;
      head: string;
      base: string;
    },
  ): Promise<{ number: number; htmlUrl: string }> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    });

    return { number: data.number, htmlUrl: data.html_url };
  }

  /**
   * Syncs the current status of a pull request from GitHub.
   * Returns 'OPEN', 'CLOSED', or 'MERGED'.
   */
  async syncPRStatus(
    organizationId: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<'OPEN' | 'CLOSED' | 'MERGED'> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: prNumber },
    );

    if (data.merged) return 'MERGED';
    if (data.state === 'closed') return 'CLOSED';
    return 'OPEN';
  }

  /**
   * Commits one or more files to a branch via the Git Data API (tree + commit).
   * Used by the CodingAgent to push generated code changes.
   */
  async commitFiles(
    organizationId: string,
    owner: string,
    repo: string,
    branch: string,
    files: Array<{ path: string; content: string }>,
    message: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // 1. Get the current HEAD SHA of the branch
    const { data: refData } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      { owner, repo, ref: `heads/${branch}` },
    );
    const latestCommitSha = refData.object.sha;

    // 2. Get the tree SHA from the latest commit
    const { data: commitData } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      { owner, repo, commit_sha: latestCommitSha },
    );
    const baseTreeSha = commitData.tree.sha;

    // 3. Create new blobs for each file
    const treeItems: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string;
    }> = [];

    for (const file of files) {
      const { data: blobData } = await octokit.request(
        'POST /repos/{owner}/{repo}/git/blobs',
        {
          owner,
          repo,
          content: Buffer.from(file.content).toString('base64'),
          encoding: 'base64',
        },
      );
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    // 4. Create a new tree
    const { data: newTree } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/trees',
      { owner, repo, base_tree: baseTreeSha, tree: treeItems },
    );

    // 5. Create a new commit
    const { data: newCommit } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner,
        repo,
        message,
        tree: newTree.sha,
        parents: [latestCommitSha],
      },
    );

    // 6. Update the branch reference
    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });
  }

  /**
   * Creates an orphan branch (no parent commit) on the given repository.
   * Used to initialise the knowledge branch with an empty history.
   */
  async createOrphanBranch(
    organizationId: string,
    owner: string,
    repo: string,
    branchName: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // 1. Create a blob for the placeholder file
    // GitHub API rejects empty trees (422), so we need at least one file.
    const { data: blob } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/blobs',
      {
        owner,
        repo,
        content: '# AI Architecture Knowledge Branch\n\nThis branch is managed automatically by WebWow AI.\n',
        encoding: 'utf-8',
      },
    );

    // 2. Create a tree with the placeholder file
    const { data: tree } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/trees',
      {
        owner,
        repo,
        tree: [
          {
            path: 'README.md',
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
          },
        ],
      },
    );

    // 3. Create an orphan commit (no parents)
    const { data: orphanCommit } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner,
        repo,
        message: 'ai: initialize knowledge branch',
        tree: tree.sha,
        parents: [],
      },
    );

    // 4. Create the branch ref pointing to the orphan commit
    try {
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: orphanCommit.sha,
      });
    } catch (err: unknown) {
      // 422 "Reference already exists" — branch was created by a previous attempt, ignore
      if (
        typeof err === 'object' && err !== null &&
        'status' in err && (err as { status: number }).status === 422
      ) {
        return; // branch already exists — that's fine
      }
      throw err;
    }
  }

  /**
   * Fetches the decoded content of a file from a specific ref.
   * Returns null when the file does not exist (404).
   */
  async getFileContent(
    organizationId: string,
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
  ): Promise<string | null> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    try {
      const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        { owner, repo, path: filePath, ref },
      );

      // The response may be a directory listing (array) — guard against that
      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Returns the list of file paths changed between two commits.
   * Returns an empty array when no files are reported by the API.
   */
  async getCommitDiff(
    organizationId: string,
    owner: string,
    repo: string,
    baseCommit: string,
    headCommit: string,
  ): Promise<string[]> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/compare/{basehead}',
      { owner, repo, basehead: `${baseCommit}...${headCommit}` },
    );

    return data.files?.map((f: { filename: string }) => f.filename) ?? [];
  }

  /**
   * Deletes one or more files from a branch in a single commit by building
   * a new Git tree with those paths set to null (removed).
   */
  async deleteFiles(
    organizationId: string,
    owner: string,
    repo: string,
    branch: string,
    filePaths: string[],
    message: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // 1. Get the current HEAD SHA of the branch
    const { data: refData } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      { owner, repo, ref: `heads/${branch}` },
    );
    const latestCommitSha = refData.object.sha;

    // 2. Get the current commit's tree SHA
    const { data: commitData } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      { owner, repo, commit_sha: latestCommitSha },
    );
    const baseTreeSha = commitData.tree.sha;

    // 3. Build a tree where each deleted path has sha: null
    const treeItems = filePaths.map((path) => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: null,
    }));

    // 4. Create the new tree
    const { data: newTree } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/trees',
      { owner, repo, base_tree: baseTreeSha, tree: treeItems },
    );

    // 5. Create a new commit
    const { data: newCommit } = await octokit.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner,
        repo,
        message,
        tree: newTree.sha,
        parents: [latestCommitSha],
      },
    );

    // 6. Update the branch reference
    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });
  }

  /**
   * Returns the HEAD commit SHA of a branch, or null when the branch does
   * not exist (404).
   */
  async getBranchHeadSha(
    organizationId: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    const token = await this.getDecryptedToken(organizationId);
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    try {
      const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/git/ref/{ref}',
        { owner, repo, ref: `heads/${branch}` },
      );
      return data.object.sha;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status: number }).status === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Verifies a GitHub webhook signature (HMAC-SHA256).
   * Returns true when the signature matches, false otherwise.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const webhookSecret =
      this.configService.get<string>('github.webhookSecret') ?? '';
    const expected = `sha256=${crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex')}`;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }
}
