FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PORT=8787 \
    COLLECT_INTERVAL_SECONDS=86400 \
    COLLECT_PAGES=20 \
    COLLECT_DAYS=30 \
    COLLECT_ON_START=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8787
CMD ["/app/docker-entrypoint.sh"]
