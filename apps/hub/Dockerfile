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
COPY apps/hub/package.json ./apps/hub/package.json
COPY apps/hub/tsconfig*.json apps/hub/.swcrc ./apps/hub/
COPY apps/hub/src ./apps/hub/src
COPY apps/hub/web ./apps/hub/web
COPY apps/hub/test/support/setup.ts ./apps/hub/test/support/setup.ts
COPY vitest.config.ts ./
RUN pnpm install --frozen-lockfile --ignore-scripts --filter haus --filter @haus/hub...
RUN pnpm --filter @haus/hub rebuild better-sqlite3
RUN pnpm -r --filter @haus/hub... build
RUN --mount=type=bind,source=packages/media/test,target=/workspace/packages/media/test,readonly pnpm exec vitest run packages/media/test/pipeline/playback.test.ts
RUN pnpm --filter @haus/hub deploy --legacy --prod /prod/hub
RUN node --input-type=module -e "import { openCatalog, openVault } from '/prod/hub/dist/storage/index.js'; const source = await openCatalog(':memory:'); const vault = await openVault(':memory:'); await vault.destroy(); await source.destroy();"
# Legacy deploy records production-only workspace state; restore the builder's test toolchain.
RUN pnpm install --frozen-lockfile --ignore-scripts --prod=false --filter haus --filter @haus/hub...

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
RUN --mount=type=bind,source=apps/hub/test,target=/workspace/apps/hub/test,readonly HAUS_HUB_TEST_ENTRYPOINT=/prod/hub/dist/main.js pnpm exec vitest run apps/hub/test/nvr/storage/workspace.test.ts apps/hub/test/runtime/workspace.test.ts apps/hub/test/runtime/monitoring.test.ts apps/hub/test/runtime/health.test.ts

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node LICENSE /usr/share/licenses/haus/LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES /usr/share/licenses/haus/THIRD_PARTY_NOTICES
COPY --from=media-verification --chown=node:node /prod/hub ./
COPY --from=camera-media-builder /src/build/haus-camera-media /usr/local/bin/haus-camera-media
COPY --from=camera-media-builder /src/build-vision/haus-vision-worker /usr/local/bin/haus-vision-worker
RUN chmod 755 /usr/local/bin/haus-camera-media /usr/local/bin/haus-vision-worker
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HAUS_DATA=/data HAUS_CONTAINER=true HAUS_VISION_BIN=/usr/local/bin/haus-vision-worker HAUS_CAMERA_MEDIA_BIN=/usr/local/bin/haus-camera-media
EXPOSE 8790 8098 8099 8555-8586/udp 8600-8631/udp
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s CMD ["node", "dist/cli/health.js"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# Explicit compatibility target for the existing HA appliance manifest/image aliases.
FROM runtime AS addon
USER root
ENV PORT=8099 HAUS_MEDIA=/media/haus

# Standalone Hub and existing NVR aliases use identical compiled application output.
FROM runtime AS hub
