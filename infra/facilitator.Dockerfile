FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.9.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/tsconfig.base.json packages/config/tsconfig.base.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/src packages/contracts/src
COPY packages/payment-client/package.json packages/payment-client/package.json
COPY packages/payment-client/src packages/payment-client/src
COPY apps/facilitator/package.json apps/facilitator/package.json
RUN pnpm install --filter @tcg/facilitator --frozen-lockfile --ignore-scripts
COPY apps/facilitator/tsconfig*.json apps/facilitator/
COPY apps/facilitator/src apps/facilitator/src
RUN pnpm --filter @tcg/facilitator build

FROM node:24-bookworm-slim
WORKDIR /app/apps/facilitator
COPY --from=build /app /app
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4022
CMD ["node", "dist/server.js"]
