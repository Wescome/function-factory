FROM node:22-slim

WORKDIR /app

# Install pi and HTTP server deps
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

EXPOSE 8080

CMD ["node", "server.mjs"]
