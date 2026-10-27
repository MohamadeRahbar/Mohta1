FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/data
ENV NODE_ENV=production
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
