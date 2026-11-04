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

FROM node:24-bookworm-slim AS camera-media-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY apps/node/native ./native
COPY packages/kitsune/src/vendors/native/tuya/cpp ./packages/kitsune/src/vendors/native/tuya/cpp
RUN cmake -S native -B build -DCMAKE_BUILD_TYPE=Release -DOPENSSL_ROOT_DIR=/usr -DKITSUNE_NATIVE_DIR=/src/packages/kitsune/src/vendors/native/tuya/cpp \
    && cmake --build build --target haus-camera-media haus-camera-feedback-test --parallel 2 \
    && ./build/haus-camera-feedback-test

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3-venv \
    && python3 -m venv /opt/vision-env \
    && /opt/vision-env/bin/pip install --no-cache-dir opencv-python-headless==4.12.0.88 numpy==2.2.6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node LICENSE /usr/share/licenses/haus-nvr/LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES /usr/share/licenses/haus-nvr/THIRD_PARTY_NOTICES
COPY --from=shared-packages --chown=node:node /prod/node ./
COPY --chown=node:node apps/node/lib ./lib
COPY --from=camera-media-builder /src/build/haus-camera-media /usr/local/bin/haus-camera-media
RUN chmod 755 /usr/local/bin/haus-camera-media
COPY --chown=node:node apps/node/vision ./vision
RUN node vision/fetch-model.mjs
RUN /opt/vision-env/bin/python3 vision/test_motion.py
RUN --mount=type=bind,source=apps/node/test,target=/app/test,readonly node --test test/playback-process.test.mjs test/transient-workspace.test.mjs
RUN --mount=type=bind,source=apps/node/test,target=/app/test,readonly HAUS_CAMERA_MEDIA_BIN=/usr/local/bin/haus-camera-media node --test test/camera-media-native.test.mjs test/native-camera-media.test.mjs test/native-rtp-burst.test.mjs test/native-interleaved-writer.test.mjs test/native-browser-answer.test.mjs
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HAUS_DATA=/data HAUS_CONTAINER=true
EXPOSE 8098 8555-8586/udp 8600-8631/udp
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8098/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "lib/main.mjs"]
