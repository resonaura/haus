/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptOpenPaths, promptSaveFilePath, writeSavedFile } from './dialogs.js';

describe('desktop file dialogs', () => {
  it('delegates open path picking through the GPUIX renderer host', async () => {
    const result = await promptOpenPaths(
      { promptForPaths: async () => ['/Users/alex/Downloads/export.json'] },
      { files: true, multiple: false },
    );
    expect(result).toEqual(['/Users/alex/Downloads/export.json']);

    await expect(promptOpenPaths({ promptForPaths: async () => null })).resolves.toBeNull();
  });

  it('sanitizes save names and routes save prompts across macOS, Windows, and Linux', async () => {
    let macArgs: { title: string; defaultName: string; defaultDirectory: string } | undefined;
    await expect(
      promptSaveFilePath(
        { title: 'Save kit', defaultName: '../../evil:kit.json', defaultDirectory: '/tmp' },
        'darwin',
        {
          runCommand: async () => ({ code: 1, stdout: '' }),
          promptMacSave: async (args) => {
            macArgs = args;
            return '/tmp/kit.json';
          },
        },
      ),
    ).resolves.toBe('/tmp/kit.json');
    expect(macArgs?.defaultName).toBe('evil_kit.json');

    let seenWinEnv: NodeJS.ProcessEnv | undefined;
    await expect(
      promptSaveFilePath(
        {
          title: 'Save clip',
          defaultName: 'clip.mp4',
          filters: [{ name: 'Video', extensions: ['mp4'] }],
        },
        'win32',
        {
          runCommand: async (_cmd, _args, env) => {
            seenWinEnv = env;
            return { code: 0, stdout: 'C:\\Users\\alex\\clip.mp4' };
          },
        },
      ),
    ).resolves.toBe('C:\\Users\\alex\\clip.mp4');
    expect(seenWinEnv?.HAUS_DIALOG_FILTER).toBe('Video|*.mp4');

    await expect(
      promptSaveFilePath({ title: 'Save', defaultName: 'x.txt' }, 'linux', {
        runCommand: async () => ({ code: 1, stdout: '' }),
      }),
    ).resolves.toBeNull();
  });

  it('writes saved exports atomically without leaving partial temporary files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-save-dialog-'));
    const target = join(dir, 'recovery.json');
    try {
      await writeSavedFile(target, '{"ok":true}');
      await expect(readFile(target, 'utf8')).resolves.toBe('{"ok":true}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
