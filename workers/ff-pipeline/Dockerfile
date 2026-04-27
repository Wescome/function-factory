# Factory Pipeline — Sandbox Agent Container
#
# Runs gdk-agent sessions (Coder / Tester roles) inside an isolated container.
# The Coordinator DO dispatches tasks to this container via Container API.
#
# Build:   docker build -t factory-sandbox workers/ff-pipeline/
# Run:     echo '{"role":"coder",...}' | docker run -i factory-sandbox

FROM node:22-slim

# System dependencies: git for workspace operations
RUN apt-get update \
    && apt-get install -y --no-install-recommends git grep \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack (available for workspace setup inside sandbox)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /factory

# Copy sandbox scripts and install dependencies
COPY sandbox-scripts/package.json ./
COPY sandbox-scripts/tool-gates.js ./
COPY sandbox-scripts/run-session.js ./

# Install dependencies.
# TODO: @weops/gdk-agent and @weops/gdk-ai are not yet published to npm.
#       When they are, this will resolve normally. Until then, the Dockerfile
#       must be built with a local npm registry, a .npmrc pointing to a
#       private registry, or by copying the built packages into the image.
RUN pnpm install --frozen-lockfile 2>/dev/null \
    || echo "WARN: pnpm install failed — GDK packages may not be published yet. Build will succeed but runtime requires packages."

EXPOSE 8080

# No HTTP server needed — this is a stdin/stdout worker.
# The CMD reads a task JSON from stdin and writes result JSON to stdout.
CMD ["node", "run-session.js"]
