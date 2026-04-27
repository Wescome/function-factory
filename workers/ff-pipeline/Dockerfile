FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git grep \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /factory

# Copy sandbox scripts (without package.json — we manage deps manually)
COPY sandbox-scripts/tool-gates.js ./
COPY sandbox-scripts/run-session.js ./

# Copy vendored GDK packages
COPY vendor/ ./vendor/

# Initialize a minimal package.json (no @weops deps listed)
RUN echo '{"type":"module","private":true}' > package.json

# Install typebox
RUN npm install --no-fund --no-audit @sinclair/typebox

# Unpack GDK packages directly to node_modules (bypasses npm resolution)
RUN mkdir -p node_modules/@weops && \
    cd node_modules/@weops && \
    tar -xzf /factory/vendor/weops-stream-types-0.1.0.tgz && mv package stream-types && \
    tar -xzf /factory/vendor/weops-gdk-ai-0.67.2.tgz && mv package gdk-ai && \
    tar -xzf /factory/vendor/weops-gdk-agent-0.67.2.tgz && mv package gdk-agent && \
    tar -xzf /factory/vendor/weops-gdk-ts-0.1.0.tgz && mv package gdk-ts

# Patch package.json: main + exports to point to dist/ instead of src/
RUN node -e " \
  const fs = require('fs'); \
  const pkgs = ['gdk-ai', 'gdk-agent', 'gdk-ts', 'stream-types']; \
  for (const pkg of pkgs) { \
    const path = 'node_modules/@weops/' + pkg + '/package.json'; \
    const p = JSON.parse(fs.readFileSync(path, 'utf8')); \
    p.main = './dist/index.js'; \
    if (p.exports) { \
      for (const [k, v] of Object.entries(p.exports)) { \
        if (typeof v === 'string') { \
          p.exports[k] = v.replace(/\\.\/src\\//, './dist/').replace(/\\.ts$/, '.js'); \
        } else if (typeof v === 'object' && v !== null) { \
          if (v.import) v.import = v.import.replace(/\\.\/src\\//, './dist/').replace(/\\.ts$/, '.js'); \
          if (v.types) v.types = v.types.replace(/\\.\/src\\//, './dist/').replace(/\\.ts$/, '.d.ts'); \
        } \
      } \
    } \
    fs.writeFileSync(path, JSON.stringify(p, null, 2)); \
  } \
  console.log('Patched exports for all GDK packages'); \
"

# Install gdk-ai transitive deps
RUN cd node_modules/@weops/gdk-ai && npm install --no-fund --no-audit --omit=dev 2>/dev/null || true

EXPOSE 8080
CMD ["node", "run-session.js"]
