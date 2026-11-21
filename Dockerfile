FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/sandbox/package.json apps/sandbox/
RUN npm ci
COPY . .
# Frontend jest wbudowywany w statyczny bundle, więc jego zależności (react, cytoscape, vite…)
# są devDependencies i znikają po prune – w obrazie zostaje tylko runtime API.
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/olcys.db
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
