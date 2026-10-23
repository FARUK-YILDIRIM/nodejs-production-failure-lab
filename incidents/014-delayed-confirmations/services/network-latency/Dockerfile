FROM node:24.22-trixie-slim
WORKDIR /srv
COPY server.ts ./
USER node
EXPOSE 5432
CMD ["node", "server.ts"]
