export interface SandboxConfig {
  taskId: string;
  repoUrl: string;
  branch: string;
  githubToken: string;
}

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SandboxInfo {
  containerId: string;
  taskId: string;
  createdAt: Date;
  timeoutAt: Date;
}
