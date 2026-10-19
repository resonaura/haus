import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = resolve('src');
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
    ),
  );
  return nested.flat();
}
const errors = [];
const files = await walk(root);
for (const file of files) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (/\.module\.(css|scss)$/.test(path)) errors.push(`${path}: use global SCSS, not CSS modules`);
  if (
    path.startsWith('renderer/src/') &&
    path.endsWith('.css') &&
    path !== 'renderer/src/styles/vendor.css'
  )
    errors.push(`${path}: author Haus styles in SCSS`);
  if (!/\.tsx?$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ];
  for (const [, specifier] of imports) {
    const target = specifier.startsWith('.')
      ? relative(root, resolve(dirname(file), specifier)).replaceAll('\\', '/')
      : specifier;
    if (
      path.startsWith('renderer/') &&
      (target.startsWith('main/') ||
        target.startsWith('preload/') ||
        specifier === 'electron' ||
        specifier.startsWith('node:'))
    )
      errors.push(`${path}: renderer must use the native bridge instead of ${specifier}`);
    if (
      path.startsWith('renderer/src/model/') &&
      !path.endsWith('.test.ts') &&
      (!specifier.startsWith('.') ||
        (!target.startsWith('renderer/src/model/') &&
          !/^renderer\/src\/assets\/.*\.svg\?raw$/.test(target)))
    )
      errors.push(`${path}: pure model must not depend on ${specifier}`);
    if (
      path.startsWith('renderer/src/components/') &&
      /^renderer\/src\/(app|features)\//.test(target)
    )
      errors.push(`${path}: shared components must not import application features (${specifier})`);
    if (path.startsWith('main/') && /^renderer\/src\/(?!model\/)/.test(target))
      errors.push(`${path}: native code may share pure model code, not UI (${specifier})`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture boundaries passed (${files.filter((file) => /\.tsx?$/.test(file)).length} source files).`,
  );
