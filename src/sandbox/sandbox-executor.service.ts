import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SandboxConfig, CommandResult, SandboxInfo } from './sandbox.types';

const execAsync = promisify(exec);

@Injectable()
export class SandboxExecutorService {
  private readonly logger = new Logger(SandboxExecutorService.name);
  private readonly activeSandboxes = new Map<string, SandboxInfo>();
  // Local mode: map containerId → temp directory path
  private readonly localWorkdirs = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  private get isLocalMode(): boolean {
    return this.configService.get<string>('SANDBOX_MODE', 'docker') === 'local';
  }

  /**
   * Creates an isolated Docker container (or local temp dir in local mode).
   * Returns containerId.
   * Requirements: R12.1, R12.2
   */
  async create(config: SandboxConfig): Promise<string> {
    if (this.isLocalMode) {
      // Local mode: create a temp directory instead of a Docker container
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `sandbox-${config.taskId}-`));
      // Create /workspace/repo subdirectory structure
      fs.mkdirSync(path.join(workdir, 'workspace'), { recursive: true });
      const containerId = `local-${config.taskId.substring(0, 8)}`;
      this.localWorkdirs.set(containerId, workdir);
      this.activeSandboxes.set(containerId, {
        containerId,
        taskId: config.taskId,
        createdAt: new Date(),
        timeoutAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      this.logger.log(`[LOCAL] Created sandbox workdir ${workdir} for task ${config.taskId}`);
      return containerId;
    }

    const cpuLimit = this.configService.get<string>('SANDBOX_CPU_LIMIT', '2');
    const memLimit = this.configService.get<string>('SANDBOX_MEMORY_LIMIT', '4g');
    const timeoutMinutes = parseInt(
      this.configService.get<string>('SANDBOX_TIMEOUT_MINUTES', '30'),
      10,
    );

    const containerName = `sandbox-${config.taskId}`;

    const cmd = [
      'docker run --rm --detach',
      `--name ${containerName}`,
      `--cpus="${cpuLimit}"`,
      `--memory="${memLimit}"`,
      '--network=sandbox-net',
      '--workdir=/workspace',
      'ai-sandbox:latest',
      `sleep ${timeoutMinutes * 60}`,
    ].join(' ');

    const { stdout } = await execAsync(cmd);
    const containerId = stdout.trim().substring(0, 12);

    const timeoutAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
    this.activeSandboxes.set(containerId, {
      containerId,
      taskId: config.taskId,
      createdAt: new Date(),
      timeoutAt,
    });

    this.logger.log(`Created sandbox container ${containerId} for task ${config.taskId}`);
    return containerId;
  }

  /**
   * Executes a command in an existing sandbox container (or local temp dir).
   * Requirements: R12.5
   */
  async exec(containerId: string, command: string, timeoutMs = 120_000): Promise<CommandResult> {
    const start = Date.now();

    if (this.isLocalMode) {
      const workdir = this.localWorkdirs.get(containerId);
      if (!workdir) {
        return { command, stdout: '', stderr: `Local sandbox ${containerId} not found`, exitCode: 1, durationMs: 0 };
      }

      // Replace /workspace with actual workdir path
      const localCmd = command.replace(/\/workspace/g, path.join(workdir, 'workspace'));

      try {
        const { stdout, stderr } = await execAsync(localCmd, {
          timeout: timeoutMs,
          cwd: path.join(workdir, 'workspace'),
          env: { ...process.env, HOME: workdir },
        });
        const durationMs = Date.now() - start;
        this.logger.debug(`[LOCAL][${containerId}] exit 0 (${durationMs}ms)`);
        return { command, stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0, durationMs };
      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { command, stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1, durationMs };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(
        `docker exec ${containerId} sh -c "${command.replace(/"/g, '\\"')}"`,
        { timeout: timeoutMs },
      );

      const durationMs = Date.now() - start;
      this.logger.debug(`[${containerId}] ${command} → exit 0 (${durationMs}ms)`);

      return { command, stdout, stderr, exitCode: 0, durationMs };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const e = err as { code?: number; stdout?: string; stderr?: string };
      const exitCode = e.code ?? 1;
      const stdout = e.stdout ?? '';
      const stderr = e.stderr ?? '';

      this.logger.debug(`[${containerId}] ${command} → exit ${exitCode} (${durationMs}ms)`);
      return { command, stdout, stderr, exitCode, durationMs };
    }
  }

  /**
   * Destroys a sandbox container (or removes local temp dir).
   * Requirements: R12.6
   */
  async destroy(containerId: string): Promise<void> {
    if (this.isLocalMode) {
      const workdir = this.localWorkdirs.get(containerId);
      if (workdir) {
        try {
          fs.rmSync(workdir, { recursive: true, force: true });
        } catch { /* ignore */ }
        this.localWorkdirs.delete(containerId);
      }
      this.activeSandboxes.delete(containerId);
      this.logger.log(`[LOCAL] Destroyed sandbox workdir for ${containerId}`);
      return;
    }

    try {
      await execAsync(`docker stop ${containerId} 2>/dev/null || true`);
      await execAsync(`docker rm -f ${containerId} 2>/dev/null || true`);
      this.activeSandboxes.delete(containerId);
      this.logger.log(`Destroyed sandbox container ${containerId}`);
    } catch (err: unknown) {
      this.logger.warn(`Failed to destroy container ${containerId}: ${String(err)}`);
    }
  }
}
