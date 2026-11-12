/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Options {
  context: string;
  base: string;
  tag: string;
}

const referencePattern =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)*[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const contextPattern = /^[A-Za-z0-9_.-]+$/;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Overlay compiled ESM only; Linux media/vision binaries remain in the verified base image.
const shared = ['core', 'bridge', 'mqtt', 'apps', 'media', 'kitsune'] as const;
const specifier = (name: string) => (name === 'bridge' ? '@haus/bridge/protocol' : `@haus/${name}`);

function options(args: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value || values.has(name)) throw Error('invalid_arguments');
    values.set(name, value);
  }
  const context = values.get('--context');
  const base = values.get('--base');
  const tag = values.get('--tag');
  if (
    values.size !== 3 ||
    !context ||
    !contextPattern.test(context) ||
    !base ||
    !referencePattern.test(base) ||
    !tag ||
    !referencePattern.test(tag)
  )
    throw Error('usage: image:overlay --context NAME --base HAUS_IMAGE --tag NEW_IMAGE');
  return { context, base, tag };
}

function run(command: string, args: readonly string[], timeout = 600_000): string {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    timeout,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    const reason = result.error ? 'spawn_error' : `exit_${result.status ?? 'unknown'}`;
    throw Error(`command_failed:${command}:${reason}`);
  }
  return result.stdout.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function manifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw Error('invalid_manifest');
  return parsed;
}

function version(path: string): string {
  const value = manifest(path).version;
  if (typeof value !== 'string' || !value.trim()) throw Error('invalid_manifest_version');
  return value;
}

function dockerfile(base: string): string {
  const patch = [
    'import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'const replace = (name, specifier) => { const root = dirname(dirname(fileURLToPath(import.meta.resolve(specifier)))); const source = "/tmp/haus-overlay/" + name.split("/").at(-1); rmSync(join(root, "dist"), { recursive: true, force: true }); cpSync(join(source, "package.json"), join(root, "package.json")); cpSync(join(source, "dist"), join(root, "dist"), { recursive: true }); };',
    'process.chdir("/app");',
    ...shared.map((name) => `replace("@haus/${name}", ${JSON.stringify(specifier(name))});`),
    'rmSync("/app/dist", { recursive: true, force: true });',
    'cpSync("/tmp/haus-overlay/hub/dist", "/app/dist", { recursive: true });',
    'const config = readFileSync("/app/dist/runtime/config.js", "utf8");',
    'const discovery = readFileSync("/app/dist/runtime/application.js", "utf8");',
    'if (!config.includes("HAUS_NVR_DATA_DIR") || !discovery.includes("startHubNvrMdnsAdvertisement")) throw Error("incompatible_hub_artifacts");',
    'if (!existsSync("/app/dist/main.js")) throw Error("hub_entrypoint_missing");',
    'console.log("overlay_verified");',
  ].join(' ');
  return [
    '# SPDX-License-Identifier: GPL-3.0-or-later.',
    `FROM ${base}`,
    'USER root',
    'COPY overlay/hub/dist/ /tmp/haus-overlay/hub/dist/',
    ...shared.flatMap((name) => [
      `COPY overlay/${name}/package.json /tmp/haus-overlay/${name}/package.json`,
      `COPY overlay/${name}/dist/ /tmp/haus-overlay/${name}/dist/`,
    ]),
    `RUN node --input-type=module -e '${patch}'`,
    'USER node',
    '',
  ].join('\n');
}

function prepare(stage: string): void {
  const roots = [
    ['hub', join(workspace, 'apps/hub')],
    ...shared.map((name) => [name, join(workspace, 'packages', name)] as const),
  ] as const;
  for (const [name, source] of roots) {
    const target = join(stage, 'overlay', name);
    const build = join(source, 'dist');
    if (
      !existsSync(
        join(build, name === 'hub' ? 'main.js' : name === 'bridge' ? 'protocol.js' : 'index.js'),
      )
    )
      throw Error(`build_missing:${name}`);
    mkdirSync(target, { recursive: true });
    cpSync(join(source, 'package.json'), join(target, 'package.json'));
    cpSync(build, join(target, 'dist'), { recursive: true });
  }
}

function main(): void {
  const config = options(process.argv.slice(2).filter((argument) => argument !== '--'));
  const inspect = run('docker', [
    '--context',
    config.context,
    'image',
    'inspect',
    config.base,
    '--format',
    '{{.Os}} {{.Architecture}}',
  ]);
  if (!inspect.startsWith('linux ')) throw Error('base_image_not_linux');

  const packageVersions = run('docker', [
    '--context',
    config.context,
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--entrypoint',
    'node',
    config.base,
    '--input-type=module',
    '-e',
    `import { dirname, join } from "node:path"; import { fileURLToPath } from "node:url"; import { readFileSync } from "node:fs"; process.chdir("/app"); const root = (name) => dirname(dirname(fileURLToPath(import.meta.resolve(name)))); const read = (path) => JSON.parse(readFileSync(path, "utf8")).version; console.log([read("/app/package.json"), ...${JSON.stringify(shared.map(specifier))}.map(name => read(join(root(name), "package.json")))].join(" "));`,
  ]);
  const versions = packageVersions.split(/\s+/);
  const expected = [
    version(join(workspace, 'apps/hub/package.json')),
    ...shared.map((name) => version(join(workspace, 'packages', name, 'package.json'))),
  ];
  if (
    versions.length !== expected.length ||
    versions.some((value, index) => value !== expected[index])
  )
    throw Error('base_image_version_mismatch');

  for (const name of shared) run('pnpm', ['--filter', `@haus/${name}`, 'build']);
  run('pnpm', ['--filter', '@haus/hub', 'build']);

  const stage = mkdtempSync(join(tmpdir(), 'haus-hub-overlay-'));
  try {
    prepare(stage);
    writeFileSync(join(stage, 'Dockerfile'), dockerfile(config.base));
    run('docker', [
      '--context',
      config.context,
      'build',
      '--network',
      'none',
      '--pull=false',
      '--file',
      join(stage, 'Dockerfile'),
      '--tag',
      config.tag,
      stage,
    ]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'image_overlay_failed';
  console.error(message);
  process.exitCode = 1;
}
