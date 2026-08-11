FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN BETTER_AUTH_SECRET=build-only-7zF4xQ9mK2vN8pR6sT1wY5cH \
    POSTGRES_HOST=localhost \
    NEXT_TELEMETRY_DISABLED=1 \
    pnpm build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
