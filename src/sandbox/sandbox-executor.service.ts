import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SandboxConfig, CommandResult, SandboxInfo } from './sandbox.types';

const execAsync = promisify(exec);

@Injectable()
export class SandboxExecutorService {
  private readonly logger = new Logger(SandboxExecutorService.name);
  private readonly activeSandboxes = new Map<string, SandboxInfo>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates an isolated Docker container for a task.
   * Returns containerId.
   * Requirements: R12.1, R12.2
   */
  async create(config: SandboxConfig): Promise<string> {
    const cpuLimit = this.configService.get<string>('SANDBOX_CPU_LIMIT', '2');
    const memLimit = this.configService.get<string>('SANDBOX_MEMORY_LIMIT', '4g');
    const timeoutMinutes = parseInt(
      this.configService.get<string>('SANDBOX_TIMEOUT_MINUTES', '30'),
      10,
    );

    const containerName = `sandbox-${config.taskId}`;

    // docker run --rm --detach --name containerName --cpus="2" --memory="4g" --network="sandbox-net" ai-sandbox:latest sleep 1800
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
    const containerId = stdout.trim().substring(0, 12); // short ID

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
   * Executes a command in an existing sandbox container.
   * Logs every command/result for audit trail.
   * Requirements: R12.5
   */
  async exec(containerId: string, command: string, timeoutMs = 120_000): Promise<CommandResult> {
    const start = Date.now();

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
   * Destroys a sandbox container and cleans up.
   * Never throws — cleanup always succeeds silently.
   * Requirements: R12.6
   */
  async destroy(containerId: string): Promise<void> {
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
