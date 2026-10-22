# Shared Recall server. Mount a persistent volume at /data.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production RECALL_DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "--no-warnings", "src/server.js"]
