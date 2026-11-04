# Haus — A thoughtful home for Home Assistant.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

FROM node:24-bookworm-slim AS shared-packages
RUN npm install --global pnpm@11.22.0 --ignore-scripts --no-audit --no-fund
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/homekit ./packages/homekit
COPY packages/media ./packages/media
COPY packages/core ./packages/core
COPY packages/state ./packages/state
COPY packages/ha ./packages/ha
COPY packages/apps ./packages/apps
COPY packages/kitsune ./packages/kitsune
COPY packages/bridge ./packages/bridge
COPY apps/node/package.json ./apps/node/package.json
COPY apps/hub/package.json ./apps/hub/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @haus/hub... --filter @haus/node...
RUN pnpm -r --filter @haus/ha... build && pnpm --filter @haus/homekit build
RUN pnpm --filter @haus/hub deploy --legacy --prod /prod/hub \
    && pnpm --filter @haus/node deploy --legacy --prod /prod/node

FROM node:24-bookworm-slim AS vision
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3-venv \
    && python3 -m venv /opt/vision-env \
    && /opt/vision-env/bin/pip install --no-cache-dir opencv-python-headless==4.12.0.88 numpy==2.2.6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY apps/node/vision ./vision
RUN node vision/fetch-model.mjs \
    && /opt/vision-env/bin/python3 vision/test_motion.py

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY LICENSE /usr/share/licenses/haus-helper/LICENSE
COPY THIRD_PARTY_NOTICES /usr/share/licenses/haus-helper/THIRD_PARTY_NOTICES
COPY --from=shared-packages --chown=node:node /prod/hub ./
COPY apps/hub/lib ./lib
RUN --mount=type=bind,source=apps/hub/test,target=/app/test,readonly node --test test/playback-audio.test.mjs
COPY --from=vision /opt/vision-env /opt/vision-env
COPY --from=vision /src/vision ./vision
COPY apps/hub/web ./web
ENV NODE_ENV=production HAUS_DATA=/data HAUS_MEDIA=/media/haus
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s CMD node -e "fetch('http://127.0.0.1:8099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "lib/main.mjs"]
