# AI Sandbox

Isolated Docker container for CodingAgent code execution.

## Security properties
- Non-root user `sandbox`
- Resource limits: 2 CPU, 4GB RAM, 10GB disk, 30 min timeout
- Network: outbound to GitHub + npm registry only
- No access to internal infrastructure
- Workspace deleted after task completion

## Building
docker build -t ai-sandbox:latest .

## Usage
Managed by SandboxExecutorService — do not run directly.
