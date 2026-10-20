FROM oven/bun:1

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.ts mangadex.ts mangapill.ts ./

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "server.ts"]
