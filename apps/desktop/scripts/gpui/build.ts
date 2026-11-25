/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, file } from 'bun';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();

const addonLoaders =
  /(?:[\\/]node_modules[\\/]@gpuix[\\/]native|[\\/]packages[\\/]gpui[\\/]vendor[\\/]gpuix[\\/]packages[\\/]native)[\\/]index\.js$|[\\/]node_modules[\\/]koffi[\\/]src[\\/]koffi[\\/]src[\\/]static\.js$/;
const demoPreviewModule = /[\\/]src[\\/]gpui[\\/]camera[\\/]preview-image\.ts$/;
const localRequire =
  /^import \{ createRequire \} from [^\n]+\nconst require = createRequire\(import\.meta\.url\);?\r?\n/m;

const native = await import('@gpuix/native').catch((cause) => {
  throw new Error(`GPUIX native addon unavailable for ${process.platform}/${process.arch}`, {
    cause,
  });
});
if (native.__napiBindingTarget !== 'native') {
  throw new Error(`Expected GPUIX native bindings, loaded ${native.__napiBindingTarget}`);
}

const output = `out/gpui/haus-preview${process.platform === 'win32' ? '.exe' : ''}`;
const result = await build({
  entrypoints: ['src/gpui/index.tsx'],
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
  compile: { outfile: output },
  plugins: [
    {
      name: 'embed desktop native addons',
      setup(builder) {
        // Bun can embed literal require() targets when the loader does not shadow require.
        builder.onLoad({ filter: addonLoaders }, async ({ path }) => {
          const source = await file(path).text();
          const contents = source.replace(localRequire, '');
          if (contents === source) throw new Error(`Unsupported native addon loader at ${path}`);
          return { contents, loader: 'js' };
        });
        builder.onLoad({ filter: demoPreviewModule }, async ({ path }) => {
          const source = await file(path).text();
          const entries = (['entryway', 'garden', 'living-room'] as const).map((key) => {
            const encoded = readFileSync(
              resolve(process.cwd(), 'src/renderer/public/images', `${key}.jpg`),
            ).toString('base64');
            return `${JSON.stringify(key)}: ${JSON.stringify(`data:image/jpeg;base64,${encoded}`)}`;
          });
          const contents = source.replace(
            'const embeddedDemoAssets: Partial<Record<DemoSceneKey, string>> = {};',
            `const embeddedDemoAssets: Partial<Record<DemoSceneKey, string>> = { ${entries.join(', ')} };`,
          );
          if (contents === source) {
            throw new Error(`Could not inline demo camera JPEGs into ${path}`);
          }
          return { contents, loader: 'ts' };
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Failed to compile the GPUIX preview');
}
console.log(`Compiled ${output}`);
