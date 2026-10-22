FROM node:24.22-trixie-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

USER node
EXPOSE 3000 9464 9229

# TypeScript runs natively (type stripping): no build step, and stack traces,
# CPU profiles and flame graphs point at the real source lines.
CMD ["node", "--inspect=0.0.0.0:9229", "--import", "./src/telemetry/register.ts", "src/server.ts"]
