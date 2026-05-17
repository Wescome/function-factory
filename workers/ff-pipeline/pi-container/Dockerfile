FROM node:22-slim

WORKDIR /app

# Install pi and HTTP server deps
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs execution-contract.mjs contract-evaluator.mjs contract-types.mjs ./

RUN mkdir -p /root/.pi/agent && \
    printf '{"providers":{"openrouter":{"baseUrl":"https://api.ofox.ai/v1"}}}\n' \
    > /root/.pi/agent/models.json

EXPOSE 8080

CMD ["node", "server.mjs"]
