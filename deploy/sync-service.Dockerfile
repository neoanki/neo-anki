ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /source
COPY . .
RUN npm ci && npm run build -w @neo-anki/sync-service

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 NEO_ANKI_SYNC_DATABASE=/data/neo-anki-sync.sqlite
WORKDIR /app
COPY --from=build /source/packages/sync-protocol/package.json ./packages/sync-protocol/package.json
COPY --from=build /source/packages/sync-protocol/dist ./packages/sync-protocol/dist
COPY --from=build /source/packages/sync-service/package.json ./packages/sync-service/package.json
COPY --from=build /source/packages/sync-service/dist ./packages/sync-service/dist
RUN mkdir -p node_modules/@neo-anki /data && ln -s /app/packages/sync-protocol /app/node_modules/@neo-anki/sync-protocol && chown -R node:node /app /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "packages/sync-service/dist/server.js"]
