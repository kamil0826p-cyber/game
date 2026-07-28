FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi \
    && npm cache clean --force
COPY --chown=node:node prisma.config.ts ./prisma.config.ts
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["npm", "start"]
