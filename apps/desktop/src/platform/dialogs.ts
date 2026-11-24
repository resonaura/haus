/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { GpuixRenderer, PathPromptOptions } from '@gpuix/native';
import { appKitBridge, type Pointer } from './appkit.js';

export type OpenDialogHost = Pick<GpuixRenderer, 'promptForPaths'>;

export interface SaveFileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface SaveFileOptions {
  readonly title: string;
  readonly defaultName?: string;
  readonly defaultDirectory?: string;
  readonly filters?: readonly SaveFileFilter[];
}

export interface DialogRunner {
  runCommand(
    command: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<{ code: number; stdout: string }>;
  promptMacSave?(options: {
    title: string;
    defaultName: string;
    defaultDirectory: string;
  }): Promise<string | null>;
}

function sanitizeFileName(name: string | undefined): string {
  const leaf = Array.from(basename(name ?? 'haus-export.json'), (character) =>
    character.charCodeAt(0) < 32 || '/\\:<>|"?*'.includes(character) ? '_' : character,
  ).join('');
  return leaf || 'haus-export.json';
}

function defaultProcessRunner(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout: stdout.trim() }));
  });
}

async function promptMacSavePanel(options: {
  title: string;
  defaultName: string;
  defaultDirectory: string;
}): Promise<string | null> {
  const koffi = await import('koffi');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const bridge = appKitBridge(koffi);
  const selector = objc.func('void *sel_registerName(const char *name)');
  const nsStringWithUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']);
  const runModal = objc.func('objc_msgSend', 'long', ['void *', 'void *']);
  const nsStringClass = bridge.klass('NSString');
  const toNsString = (value: string): Pointer =>
    nsStringWithUtf8(nsStringClass, selector('stringWithUTF8String:'), value);

  const savePanelClass = bridge.klass('NSSavePanel');
  const panel = bridge.id(savePanelClass, 'savePanel');
  if (!panel) throw new Error('macOS save panel is unavailable.');
  bridge.object(panel, 'setTitle:', toNsString(options.title));
  bridge.object(panel, 'setNameFieldStringValue:', toNsString(options.defaultName));
  const dirUrl = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *'])(
    bridge.klass('NSURL'),
    selector('fileURLWithPath:'),
    toNsString(options.defaultDirectory),
  );
  if (dirUrl) bridge.object(panel, 'setDirectoryURL:', dirUrl);
  const response = runModal(panel, selector('runModal'));
  if (response !== 1) return null;
  const selectedUrl = bridge.id(panel, 'URL');
  const pathStr = selectedUrl && bridge.id(selectedUrl, 'path');
  return pathStr ? bridge.string(pathStr) : null;
}

export async function promptOpenPaths(
  host: OpenDialogHost,
  options: PathPromptOptions = { files: true },
): Promise<readonly string[] | null> {
  const result = await host.promptForPaths(options);
  return result?.length ? result : null;
}

export async function promptSaveFilePath(
  options: SaveFileOptions,
  platform: NodeJS.Platform = process.platform,
  deps: DialogRunner = { runCommand: defaultProcessRunner, promptMacSave: promptMacSavePanel },
): Promise<string | null> {
  const title = options.title.trim() || 'Save file';
  const defaultName = sanitizeFileName(options.defaultName);
  const defaultDirectory = options.defaultDirectory || join(homedir(), 'Downloads');

  if (platform === 'darwin') {
    const prompt = deps.promptMacSave ?? promptMacSavePanel;
    return prompt({ title, defaultName, defaultDirectory });
  }

  if (platform === 'win32') {
    const filter = options.filters?.length
      ? options.filters
          .map((f) => `${f.name}|${f.extensions.map((ext) => `*.${ext.replace(/[^a-zA-Z0-9]/g, '')}`).join(';')}`)
          .join('|')
      : 'All files (*.*)|*.*';
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
      '$dialog.Title = $env:HAUS_DIALOG_TITLE',
      '$dialog.InitialDirectory = $env:HAUS_DIALOG_DIR',
      '$dialog.FileName = $env:HAUS_DIALOG_FILE',
      '$dialog.Filter = $env:HAUS_DIALOG_FILTER',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $dialog.FileName }',
    ].join('; ');
    const result = await deps.runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      {
        ...process.env,
        HAUS_DIALOG_TITLE: title,
        HAUS_DIALOG_DIR: defaultDirectory,
        HAUS_DIALOG_FILE: defaultName,
        HAUS_DIALOG_FILTER: filter,
      },
    );
    return result.code === 0 && result.stdout ? result.stdout : null;
  }

  if (platform === 'linux') {
    const candidates: readonly (readonly [string, readonly string[]])[] = [
      [
        'zenity',
        [
          '--file-selection',
          '--save',
          '--confirm-overwrite',
          `--title=${title}`,
          `--filename=${join(defaultDirectory, defaultName)}`,
        ],
      ],
      ['kdialog', ['--getsavefilename', join(defaultDirectory, defaultName), '--title', title]],
    ];
    for (const [command, args] of candidates) {
      try {
        const result = await deps.runCommand(command, args);
        if (result.code === 0 && result.stdout) return result.stdout;
        if (result.code === 1) return null;
      } catch {
        /* Try the next desktop portal/dialog tool. */
      }
    }
    throw new Error('No native file save dialog backend was found on this desktop.');
  }

  throw new Error('File save dialogs are not supported on this operating system.');
}

export async function writeSavedFile(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
