FROM node:22-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install pi and HTTP server deps
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs execution-contract.mjs contract-evaluator.mjs contract-types.mjs contract-materializer.mjs execution-policy.mjs workspace-seed.mjs workspace-derived-artifacts.mjs tool-capability-probe.mjs ./

RUN mkdir -p /root/.pi/agent && \
    printf '{"providers":{"openrouter":{"baseUrl":"https://api.ofox.ai/v1"}}}\n' \
    > /root/.pi/agent/models.json

EXPOSE 8080

CMD ["node", "server.mjs"]
