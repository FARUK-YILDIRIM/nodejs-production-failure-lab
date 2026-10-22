FROM node:24.22-trixie-slim
WORKDIR /srv
COPY server.ts ./
USER node
EXPOSE 8090 9464
CMD ["node", "server.ts"]
