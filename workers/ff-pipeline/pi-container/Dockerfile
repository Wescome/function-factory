FROM node:22-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install pi and HTTP server deps
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs execution-contract.mjs contract-evaluator.mjs contract-types.mjs contract-materializer.mjs execution-policy.mjs workspace-seed.mjs workspace-derived-artifacts.mjs path-guard.mjs tool-capability-probe.mjs stage-runtime.mjs prompt-diagnostics.mjs ./
COPY ./server.mjs ./server.mjs
RUN test -f /app/workspace-derived-artifacts.mjs && test -f /app/path-guard.mjs
RUN grep -q normalizeOutputContracts /app/server.mjs

RUN mkdir -p /root/.pi/agent && \
    printf '{"providers":{"openrouter":{"baseUrl":"https://api.ofox.ai/v1","api":"openai-completions","apiKey":"OFOX_API_KEY","authHeader":true}}}\n' \
    > /root/.pi/agent/models.json && \
    printf '{"credentials":[]}\n' \
    > /root/.pi/agent/auth.json

EXPOSE 8080

CMD ["node", "server.mjs"]
