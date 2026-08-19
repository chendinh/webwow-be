# AI Sandbox — isolated execution environment for CodingAgent
# Base: Node.js LTS on Alpine (minimal attack surface)
FROM node:20-alpine

# Install Git (needed for cloning repos) and basic tools
RUN apk add --no-cache git bash curl

# Create a non-root user for executing code (security)
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

# Working directory
WORKDIR /workspace

# Set ownership to sandbox user
RUN chown -R sandbox:sandbox /workspace

# Switch to non-root user
USER sandbox

# Default command (overridden by docker exec calls)
CMD ["/bin/sh"]
