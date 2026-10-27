import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecoveryDiagnostics } from './recovery-diagnostics';

it('retains only bounded private allowlisted reports across logger restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-recovery-log-'));
  try {
    const log = new RecoveryDiagnostics(root, 500);
    for (let n = 0; n < 12; n++)
      log.write({
        kind: 'main',
        name: 'TypeError',
        reference: n.toString(16).padStart(8, '0'),
        frames: ['index.js:123:4', 'file:///private/index.js:1:2', 'rtsp://secret'],
        message: 'secret',
        token: 'secret',
      });
    await log.flush();
    const restarted = new RecoveryDiagnostics(root, 500);
    restarted.write({
      kind: 'main',
      name: 'Error',
      reference: 'ffffffff',
      frames: ['index.mjs:456:7'],
    });
    await restarted.flush();
    const files = (await readdir(root)).sort();
    expect(files).toEqual(['recovery.log', 'recovery.previous.log']);
    for (const name of files) {
      const path = join(root, name),
        info = await stat(path),
        text = await readFile(path, 'utf8');
      expect(info.size).toBeLessThanOrEqual(500);
      if (process.platform !== 'win32') expect(info.mode & 0o077).toBe(0);
      expect(text).not.toMatch(/secret|private|token|rtsp|file:/);
      expect(
        text
          .trim()
          .split('\n')
          .every((line) => JSON.parse(line).kind === 'main'),
      ).toBe(true);
    }
    expect(
      JSON.parse((await readFile(join(root, 'recovery.log'), 'utf8')).trim().split('\n').at(-1)!)
        .reference,
    ).toBe('ffffffff');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('invalid input and an unwritable path cannot make recovery fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-recovery-log-error-'));
  try {
    const bad = join(root, 'file');
    await writeFile(bad, 'fixture');
    const log = new RecoveryDiagnostics(bad);
    log.write(null);
    log.write({ kind: 'render', message: 'secret' });
    log.write({ kind: 'main', name: 'Error', reference: '12345678' });
    await expect(log.flush()).resolves.toBeUndefined();
    expect(await readFile(bad, 'utf8')).toBe('fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
