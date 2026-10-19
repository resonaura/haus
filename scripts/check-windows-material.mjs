import { app, BrowserWindow } from 'electron';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
if (process.platform !== 'win32')
  throw new Error('Run the native material smoke check on Windows.');
let directory, window;
try {
  await app.whenReady();
  // Transpile only the native bridge, keeping its dependency lookup inside this checkout.
  directory = await mkdtemp(join(process.cwd(), 'node_modules', '.haus-material-'));
  const source = await readFile(new URL('../src/main/windows-acrylic.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = join(directory, 'windows-acrylic.mjs');
  await writeFile(file, compiled);
  const bridge = await import(pathToFileURL(file).href);
  window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true },
  });
  if (bridge.decodeWindowHandle(window.getNativeWindowHandle()) === 0n)
    throw new Error('Electron did not provide a native HWND.');
  if (!bridge.applyWindowsAcrylicFallback(window, process.getSystemVersion()))
    throw new Error('The native material path rejected the real window.');
  // Exercise Windows 10's compatibility ABI on an actual HWND, twice to catch repeated FFI type registration.
  for (let i = 0; i < 2; i++)
    if (!bridge.applyWindowsAcrylicFallback(window, '10.0.19045', undefined, i === 0))
      throw new Error('The legacy composition API rejected the real window.');
  console.log(`Windows native material smoke check passed (${process.arch}).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window?.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}
