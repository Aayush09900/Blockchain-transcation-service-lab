FROM node:22.23.3-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package*.json ./

RUN npm install --global npm@12.1.0 --ignore-scripts --no-audit --no-fund \
    && NPM_ROOT="$(npm root --global)/npm" \
    && npm install --prefix "$NPM_ROOT" --no-save --ignore-scripts --no-audit --no-fund brace-expansion@5.0.10 undici@6.28.1 \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY src ./src

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/http-server.js"]
