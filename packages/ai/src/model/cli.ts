/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ModelInstaller } from './download.js';

if (process.argv.length !== 2) throw Error('Usage: pnpm --filter @haus/ai model');
const value: unknown = JSON.parse(
  await readFile(new URL('../../vision/model.json', import.meta.url), 'utf8'),
);
await new ModelInstaller().install(
  value,
  fileURLToPath(new URL('../../vision/model.onnx', import.meta.url)),
);
