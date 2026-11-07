# Haus AI

`@haus/ai` owns analysis admission, vision workers and detector model assets. Shared media processes remain in `@haus/media`.

From the repository root, build with `pnpm --filter @haus/ai build`, then explicitly download the pinned NanoDet model with `pnpm --filter @haus/ai model`. This replaces the old `apps/node/vision/fetch-model.mjs` and `packages/ai/vision/fetch-model.mjs` commands. No download runs during ordinary builds/tests or service startup.

The strict TypeScript installer validates `vision/model.json`, permits only a pinned HTTPS revision, rejects redirects, bounds the response to 64 MiB and verifies its SHA-256 digest while streaming. It writes a unique temporary file beside `vision/model.onnx`, flushes it, and replaces the previous artifact only after verification. Failed/interrupted downloads preserve the previous model and remove their own temporary file. The detector's existing model path is unchanged.

The manifest, Apache-2.0 license and notice remain in [vision](vision/NOTICE.md). Synthetic test downloads never contact the upstream server. Actual model download and inference on physical cameras require their own validation.
