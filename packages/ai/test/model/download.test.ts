/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect, type TestContext } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ModelInstaller, MAX_MODEL_BYTES } from '../../src/model/download.js';

const revision = 'a'.repeat(40);
const bytes = Buffer.from('synthetic model bytes');
const manifest = {
  revision,
  url: `https://fixture.invalid/models/${revision}/model.onnx`,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'haus-model-download-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'model.onnx');
  await writeFile(output, 'previous model');
  return { root, output };
}

test('streams and verifies a pinned model before replacing the previous artifact', async (context) => {
  const { root, output } = await fixture(context);
  const request: typeof fetch = async (_url, options) => {
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 5));
          controller.enqueue(bytes.subarray(5));
          controller.close();
        },
      }),
    );
  };
  await new ModelInstaller(request).install(manifest, output);
  expect(await readFile(output)).toEqual(bytes);
  expect(await readdir(root)).toEqual(['model.onnx']);
});

test('rejects malformed or unpinned manifests before requesting anything', async (context) => {
  const { output } = await fixture(context);
  let requests = 0;
  const installer = new ModelInstaller(async () => {
    requests++;
    return new Response(bytes);
  });
  for (const value of [
    null,
    {},
    { ...manifest, sha256: 'invalid' },
    { ...manifest, revision: 'invalid' },
    { ...manifest, url: manifest.url.replace(revision, 'latest') },
    { ...manifest, url: manifest.url.replace('https:', 'http:') },
    { ...manifest, url: manifest.url.replace('fixture.invalid', 'user:secret@fixture.invalid') },
  ])
    await expect(installer.install(value, output)).rejects.toThrow();
  expect(requests).toBe(0);
  expect(await readFile(output, 'utf8')).toBe('previous model');
});

for (const failure of ['digest', 'http', 'interrupted', 'announced-size', 'stream-size'])
  test(`preserves the previous model and removes partial work after ${failure} failure`, async (context) => {
    const { root, output } = await fixture(context);
    let chunks = 0;
    const installer = new ModelInstaller(async () => {
      if (failure === 'http') return new Response(null, { status: 503 });
      if (failure === 'announced-size')
        return new Response(bytes, {
          headers: { 'content-length': String(MAX_MODEL_BYTES + 1) },
        });
      if (failure === 'digest') return new Response('corrupt model');
      const chunk = Buffer.alloc(1024 ** 2);
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (failure === 'interrupted' && chunks++)
              controller.error(Error('fixture disconnected'));
            else controller.enqueue(chunk);
          },
        }),
      );
    });
    const error =
      failure === 'digest'
        ? 'vision_model_digest_mismatch'
        : failure === 'http'
          ? 'vision_model_download_failed'
          : failure === 'interrupted'
            ? 'fixture disconnected'
            : 'vision_model_size_limit';
    await expect(installer.install(manifest, output)).rejects.toThrow(error);
    expect(await readFile(output, 'utf8')).toBe('previous model');
    expect(await readdir(root)).toEqual(['model.onnx']);
  });
