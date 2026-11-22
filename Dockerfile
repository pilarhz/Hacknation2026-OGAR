FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/sandbox/package.json apps/sandbox/
RUN npm ci
COPY . .
# Frontend to statyczny bundle – jego zależności (react, vite…) są devDependencies i znikają po prune.
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
# Z DATABASE_URL (docker-compose) – serwer PostgreSQL; bez niego wbudowany PostgreSQL w /data/pg.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/pg
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/data apps/api/data
COPY --from=build /app/apps/sandbox apps/sandbox
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/api/src/server.ts"]
