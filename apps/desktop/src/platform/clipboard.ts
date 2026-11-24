/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn } from 'node:child_process';

const MAX_CLIPBOARD_BYTES = 1024 * 1024;
const CLIPBOARD_TIMEOUT_MS = 5000;

export interface ClipboardRunnerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ClipboardCommandRunner = (
  command: string,
  args: readonly string[],
  stdin?: string,
) => Promise<ClipboardRunnerResult>;

async function runProcess(
  command: string,
  args: readonly string[],
  stdin?: string,
): Promise<ClipboardRunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let byteCount = 0;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Clipboard operation timed out.'));
    }, CLIPBOARD_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      byteCount += Buffer.byteLength(chunk, 'utf8');
      if (byteCount > MAX_CLIPBOARD_BYTES) {
        clearTimeout(timer);
        child.kill('SIGTERM');
        reject(new Error('Clipboard content exceeds the 1 MiB limit.'));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
}

export class NativeClipboard {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly run: ClipboardCommandRunner = runProcess,
  ) {}

  async writeText(text: string): Promise<void> {
    if (typeof text !== 'string' || text.includes('\0')) {
      throw new Error('Clipboard text must be a valid string.');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES) {
      throw new Error('Clipboard content exceeds the 1 MiB limit.');
    }
    for (const [command, args] of this.writeCandidates()) {
      try {
        const result = await this.run(command, args, text);
        if (result.code === 0) return;
      } catch {
        /* Try next clipboard utility if multiple are available on Linux. */
      }
    }
    throw new Error('Could not write to the system clipboard.');
  }

  async readText(): Promise<string> {
    for (const [command, args] of this.readCandidates()) {
      try {
        const result = await this.run(command, args);
        if (result.code === 0) return result.stdout;
      } catch {
        /* Try next clipboard utility if multiple are available on Linux. */
      }
    }
    throw new Error('Could not read from the system clipboard.');
  }

  private writeCandidates(): readonly (readonly [string, readonly string[]])[] {
    if (this.platform === 'darwin') return [['pbcopy', []]];
    if (this.platform === 'win32') {
      return [
        [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
          ],
        ],
      ];
    }
    if (this.platform === 'linux') {
      return this.env.WAYLAND_DISPLAY
        ? [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ]
        : [
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
            ['wl-copy', []],
          ];
    }
    return [];
  }

  private readCandidates(): readonly (readonly [string, readonly string[]])[] {
    if (this.platform === 'darwin') return [['pbpaste', []]];
    if (this.platform === 'win32') {
      return [
        [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw',
          ],
        ],
      ];
    }
    if (this.platform === 'linux') {
      return this.env.WAYLAND_DISPLAY
        ? [
            ['wl-paste', ['--no-newline']],
            ['xclip', ['-selection', 'clipboard', '-o']],
            ['xsel', ['--clipboard', '--output']],
          ]
        : [
            ['xclip', ['-selection', 'clipboard', '-o']],
            ['xsel', ['--clipboard', '--output']],
            ['wl-paste', ['--no-newline']],
          ];
    }
    return [];
  }
}
