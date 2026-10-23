import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readlink, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };

if (process.platform === 'darwin') {
  const electronApp = join(root, 'node_modules/electron/dist/Electron.app');
  const wrapper = join(root, '.cache/haus-dev/Haus.app');
  const executable = join(wrapper, 'Contents/MacOS/Electron');
  const wrapperInfo = join(wrapper, 'Contents/Info.plist');
  const icon = join(wrapper, 'Contents/Resources/haus.icns');
  const frameworkResources = join(
    wrapper,
    'Contents/Frameworks/Electron Framework.framework/Resources',
  );
  const sourceInfo = join(electronApp, 'Contents/Info.plist');
  const sourceIcon = join(root, 'build/icon.icns');
  const [source, current] = await Promise.all([
    stat(sourceInfo),
    stat(wrapperInfo).catch(() => null),
  ]);
  const iconInfo = await stat(sourceIcon);
  const frameworkLink = await readlink(frameworkResources).catch(() => '');
  const refresh =
    !current ||
    isAbsolute(frameworkLink) ||
    current.mtimeMs < source.mtimeMs ||
    (await stat(icon).catch(() => null))?.mtimeMs < iconInfo.mtimeMs;
  if (refresh) {
    await mkdir(dirname(wrapper), { recursive: true });
    await rm(wrapper, { recursive: true, force: true });
    const copied = spawnSync('/usr/bin/ditto', [electronApp, wrapper], {
      encoding: 'utf8',
    });
    if (copied.status !== 0)
      throw new Error(`Could not prepare the temporary Haus app: ${copied.stderr}`);
    const iconCopy = spawnSync('/bin/cp', [sourceIcon, icon], { encoding: 'utf8' });
    if (iconCopy.status !== 0)
      throw new Error(`Could not copy the Haus development icon: ${iconCopy.stderr}`);
    for (const [key, value] of [
      ['CFBundleName', 'Haus'],
      ['CFBundleDisplayName', 'Haus'],
      ['CFBundleIdentifier', 'app.haus.desktop.dev'],
      ['CFBundleIconFile', 'haus'],
    ]) {
      const result = spawnSync(
        '/usr/libexec/PlistBuddy',
        ['-c', `Set :${key} ${value}`, join(wrapper, 'Contents/Info.plist')],
        { encoding: 'utf8' },
      );
      if (result.status !== 0)
        throw new Error(`Could not brand the temporary Haus development app: ${key}`);
    }
  }
  env.ELECTRON_EXEC_PATH = executable;
  // Electron uses the workspace's package.json and freshly-built out/main entry.
  env.ELECTRON_ENTRY = root;
}

const bin = join(root, 'node_modules/.bin/electron-vite');
const child = spawn(bin, ['dev'], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`Could not start Haus development server: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
