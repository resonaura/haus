FROM node:24-bookworm-slim AS vision
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3-venv \
    && python3 -m venv /opt/vision-env \
    && /opt/vision-env/bin/pip install --no-cache-dir opencv-python-headless==4.12.0.88 numpy==2.2.6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY apps/nvr/vision ./vision
RUN node vision/fetch-model.mjs \
    && /opt/vision-env/bin/python3 vision/test_motion.py

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/helper/haus-helper/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY apps/helper/haus-helper/lib ./lib
RUN --mount=type=bind,source=apps/helper/haus-helper/test,target=/app/test,readonly node --test test/playback-audio.test.mjs
COPY --from=vision /opt/vision-env /opt/vision-env
COPY --from=vision /src/vision ./vision
COPY apps/helper/haus-helper/web ./web
ENV NODE_ENV=production HAUS_DATA=/data HAUS_MEDIA=/media/haus
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s CMD node -e "fetch('http://127.0.0.1:8099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "lib/main.mjs"]
