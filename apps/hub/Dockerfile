# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

FROM node:24-bookworm-slim AS shared-packages
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.22.0 --ignore-scripts --no-audit --no-fund \
    && pnpm config set store-dir /pnpm-store --location=global \
    && pnpm config set package-import-method copy --location=global
WORKDIR /workspace
# Copy workspace manifests first so pnpm install and native builds stay cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/homekit/package.json ./packages/homekit/
COPY packages/media/package.json ./packages/media/
COPY packages/core/package.json ./packages/core/
COPY packages/state/package.json ./packages/state/
COPY packages/ha/package.json ./packages/ha/
COPY packages/apps/package.json ./packages/apps/
COPY packages/kitsune/package.json ./packages/kitsune/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/ai/package.json ./packages/ai/
COPY packages/servers/package.json ./packages/servers/
COPY packages/mqtt/package.json ./packages/mqtt/
COPY packages/matter/package.json ./packages/matter/
COPY packages/zigbee/package.json ./packages/zigbee/
COPY packages/thread/package.json ./packages/thread/
COPY apps/hub/package.json ./apps/hub/
# Populate /prod/hub third-party node_modules and native bindings in the manifest layer so code edits skip pnpm deploy.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --ignore-scripts --filter haus --filter @haus/hub... \
    && pnpm --filter @haus/hub rebuild better-sqlite3 \
    && pnpm --filter @haus/hub deploy --legacy --prod /prod/hub \
    && node --input-type=module -e "import { createRequire } from 'node:module'; const db = createRequire('/prod/hub/package.json')('better-sqlite3')(':memory:'); db.close();" \
    && pnpm install --frozen-lockfile --ignore-scripts --offline --prod=false --filter haus --filter @haus/hub...
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
COPY apps/hub/tsconfig*.json apps/hub/.swcrc ./apps/hub/
COPY apps/hub/src ./apps/hub/src
COPY apps/hub/web ./apps/hub/web
COPY apps/hub/test/support/setup.ts ./apps/hub/test/support/setup.ts
COPY vitest.config.ts ./
RUN make -C packages/ai/native clean
RUN pnpm -r --filter @haus/hub... build
RUN --mount=type=bind,source=packages/media/test,target=/workspace/packages/media/test,readonly pnpm exec vitest run --testTimeout=30000 packages/media/test/pipeline/playback.test.ts
# Sync compiled workspace outputs and runtime assets into the cached /prod/hub tree offline.
RUN node --input-type=module -e "\
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'; \
import { dirname, join } from 'node:path'; \
const syncDir = (src, dst) => { if (!existsSync(src)) return; rmSync(dst, { recursive: true, force: true }); mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst, { recursive: true }); }; \
syncDir('/workspace/apps/hub/dist', '/prod/hub/dist'); \
syncDir('/workspace/apps/hub/web', '/prod/hub/web'); \
for (const entry of readdirSync('/prod/hub/node_modules/.pnpm')) { \
  const m = /^@haus\+([^@]+)@file\+packages\+([^/_]+)/.exec(entry); \
  if (!m) continue; \
  const srcPkg = join('/workspace/packages', m[2]); \
  const dstPkg = join('/prod/hub/node_modules/.pnpm', entry, 'node_modules/@haus', m[1]); \
  for (const rel of ['dist', 'data', 'vision', 'native', 'install', 'src/vendors/native/tuya/cpp']) syncDir(join(srcPkg, rel), join(dstPkg, rel)); \
} \
" \
    && node --input-type=module -e "import { openCatalog, openVault } from '/prod/hub/dist/storage/index.js'; const source = await openCatalog(':memory:'); const vault = await openVault(':memory:'); await vault.destroy(); await source.destroy();"

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
RUN --mount=type=bind,source=packages/media/test,target=/workspace/packages/media/test,readonly HAUS_CAMERA_MEDIA_BIN=/usr/local/bin/haus-camera-media pnpm exec vitest run --maxWorkers=1 --exclude '**/._*' packages/media/test/native
RUN --mount=type=bind,source=apps/hub/test,target=/workspace/apps/hub/test,readonly HAUS_HUB_TEST_ENTRYPOINT=/prod/hub/dist/main.js pnpm exec vitest run --exclude '**/._*' --testTimeout=90000 apps/hub/test/nvr/storage/workspace.test.ts apps/hub/test/runtime/workspace.test.ts apps/hub/test/runtime/monitoring.test.ts apps/hub/test/runtime/health.test.ts

FROM ghcr.io/astral-sh/uv:0.11 AS uv-bin

FROM node:24-bookworm-slim AS ha-venv-builder
ARG HA_VERSION=""
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates build-essential pkg-config libffi-dev libssl-dev zlib1g-dev libjpeg62-turbo-dev libusb-1.0-0-dev libudev-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=uv-bin /uv /usr/local/bin/uv
COPY apps/hub/deploy/requirements.py /tmp/ha-requirements.py
ENV UV_PYTHON_INSTALL_DIR=/opt/ha-python
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    HA_PKG="${HA_VERSION:+homeassistant==${HA_VERSION}}" && HA_PKG="${HA_PKG:-homeassistant}" \
    && uv venv /opt/ha-venv --python 3.14 \
    && uv pip install --python /opt/ha-venv/bin/python \
      "$HA_PKG" uv voluptuous-serialize \
    && CONSTRAINTS="$(/opt/ha-venv/bin/python -c 'import pathlib, homeassistant; print(pathlib.Path(homeassistant.__file__).with_name("package_constraints.txt"))')" \
    && uv pip install --python /opt/ha-venv/bin/python -c "$CONSTRAINTS" \
      PyTurboJPEG aiodhcpwatcher aiodiscover async-upnp-client \
      bleak-retry-connector bleak bluetooth-adapters bluetooth-auto-recovery bluetooth-data-tools \
      cached-ipaddress dbus-fast fnv-hash-fast ha-ffmpeg habluetooth \
      hassil home-assistant-intents ifaddr paho-mqtt psutil-home-assistant \
      pyserial pyudev zeroconf \
    && /opt/ha-venv/bin/python /tmp/ha-requirements.py esphome hassio tag usb zeroconf > /tmp/ha-flow-requirements.txt \
    && uv pip install --python /opt/ha-venv/bin/python -c "$CONSTRAINTS" -r /tmp/ha-flow-requirements.txt \
    && /opt/ha-venv/bin/python -c 'import homeassistant.components.esphome.config_flow' \
    && chmod -R a+rX /opt/ha-python /opt/ha-venv

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates tini python3 libusb-1.0-0 libudev1 libturbojpeg0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=uv-bin /uv /usr/local/bin/uv
COPY --from=ha-venv-builder /opt/ha-python /opt/ha-python
COPY --from=ha-venv-builder /opt/ha-venv /opt/ha-venv
WORKDIR /app
COPY --chown=node:node LICENSE /usr/share/licenses/haus/LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES /usr/share/licenses/haus/THIRD_PARTY_NOTICES
COPY --from=media-verification --chown=node:node /prod/hub ./
COPY --from=camera-media-builder /src/build/haus-camera-media /usr/local/bin/haus-camera-media
COPY --from=camera-media-builder /src/build-vision/haus-vision-worker /usr/local/bin/haus-vision-worker
RUN chmod 755 /usr/local/bin/haus-camera-media /usr/local/bin/haus-vision-worker /usr/local/bin/uv
RUN node dist/cli/catalog.js seed --out-dir /opt/ha-catalog-seed \
    && mkdir -p /data \
    && chown -R node:node /data /opt/ha-catalog-seed
USER node
ENV NODE_ENV=production HAUS_DATA=/data HAUS_CONTAINER=true HAUS_CATALOG_SEED_DIR=/opt/ha-catalog-seed HAUS_VISION_BIN=/usr/local/bin/haus-vision-worker HAUS_CAMERA_MEDIA_BIN=/usr/local/bin/haus-camera-media HAUS_HA_PYTHON=/opt/ha-venv/bin/python UV_CACHE_DIR=/data/uv-cache
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
