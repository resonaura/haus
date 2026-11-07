/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entrypoint = fileURLToPath(new URL('../../../dist/cli/recover.js', import.meta.url));

export function recoveryCli(kit: string, nodeId: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, '--kit', kit, '--node', nodeId, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', (data: Buffer) => {
      if (output.length + data.length > 1024 * 1024) child.kill('SIGKILL');
      else output += data.toString();
    });
    // Drain diagnostics without forwarding private recovery material into test output.
    child.stderr.resume();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(Error('fixture_recovery_cli_failed'));
    });
  });
}
