# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

FROM node:24-bookworm-slim AS shared-packages
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg \
    && rm -rf /var/lib/apt/lists/*
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
COPY packages/ai ./packages/ai
COPY packages/servers ./packages/servers
COPY packages/mqtt ./packages/mqtt
COPY packages/matter ./packages/matter
COPY packages/zigbee ./packages/zigbee
COPY packages/thread ./packages/thread
COPY apps/node/package.json ./apps/node/package.json
COPY apps/hub/package.json ./apps/hub/package.json
COPY apps/hub/tsconfig*.json apps/hub/.swcrc ./apps/hub/
COPY apps/hub/src ./apps/hub/src
COPY apps/hub/test/support/setup.ts ./apps/hub/test/support/setup.ts
COPY vitest.config.ts ./
RUN pnpm install --frozen-lockfile --ignore-scripts --filter haus --filter @haus/hub... --filter @haus/node...
RUN pnpm --filter @haus/hub rebuild better-sqlite3
RUN pnpm -r --filter @haus/hub... build
RUN --mount=type=bind,source=packages/media/test,target=/workspace/packages/media/test,readonly pnpm exec vitest run packages/media/test/pipeline/playback.test.ts
RUN pnpm --filter @haus/hub deploy --legacy --prod /prod/hub \
    && pnpm --filter @haus/node deploy --legacy --prod /prod/node

FROM node:24-bookworm-slim AS camera-media-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY packages/media/native ./native
COPY packages/kitsune/src/vendors/native/tuya/cpp ./packages/kitsune/src/vendors/native/tuya/cpp
COPY packages/ai/native ./packages/ai/native
RUN cmake -S native -B build -DCMAKE_BUILD_TYPE=Release -DOPENSSL_ROOT_DIR=/usr -DKITSUNE_NATIVE_DIR=/src/packages/kitsune/src/vendors/native/tuya/cpp \
    && cmake --build build --target haus-camera-media haus-camera-feedback-test haus-media-continuity-test haus-media-writer-test haus-media-pacer-test --parallel 2 \
    && ctest --test-dir build -L haus --output-on-failure
RUN cmake -S packages/ai/native -B build-vision -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build-vision --target haus-vision-worker haus-vision-test --parallel 2 \
    && ./build-vision/haus-vision-test

FROM shared-packages AS media-verification
COPY --from=camera-media-builder /src/build/haus-camera-media /usr/local/bin/haus-camera-media
RUN --mount=type=bind,source=packages/media/test,target=/workspace/packages/media/test,readonly HAUS_CAMERA_MEDIA_BIN=/usr/local/bin/haus-camera-media pnpm exec vitest run packages/media/test/native

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node LICENSE /usr/share/licenses/haus-nvr/LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES /usr/share/licenses/haus-nvr/THIRD_PARTY_NOTICES
COPY --from=media-verification --chown=node:node /prod/node ./
COPY --from=camera-media-builder /src/build/haus-camera-media /usr/local/bin/haus-camera-media
COPY --from=camera-media-builder /src/build-vision/haus-vision-worker /usr/local/bin/haus-vision-worker
RUN chmod 755 /usr/local/bin/haus-camera-media /usr/local/bin/haus-vision-worker
RUN --mount=type=bind,source=apps/node/test,target=/app/test,readonly node --test test/transient-workspace.test.mjs
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HAUS_DATA=/data HAUS_CONTAINER=true HAUS_VISION_BIN=/usr/local/bin/haus-vision-worker
EXPOSE 8098 8555-8586/udp 8600-8631/udp
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8098/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/@haus/hub/dist/main.js"]
