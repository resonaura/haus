/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { recover } from '../../src/recovery/export.js';
import { recoveryOptions } from '../../src/recovery/options.js';
import { readRecoveryKit } from '../../src/recovery/client.js';
import { authenticator } from '../../src/nvr/auth.js';
import { key } from './support.js';
const id = 'a89f5665-1a68-4cde-bcf0-451ec77edb1a';

it('rejects ambiguous CLI actions, duplicate arguments and missing option values', () => {
  for (const args of [
    ['--kit', 'k', '--node', 'n'],
    ['--kit', '--node', 'n', '--list'],
    ['--kit', 'k', '--node', 'n', '--list', '--recording', id],
    ['--kit', 'k', '--node', 'n', '--list', '--output', 'archive'],
    ['--kit', 'k', '--node', 'n', '--list', '--kit', 'other'],
    ['--kit', 'k', '--node', 'n', '--recording', '../bad', '--output', 'a'],
  ])
    expect(() => recoveryOptions(args)).toThrow('invalid_recovery_arguments');
});

it('exports verified recording bytes, refuses overwrite and rejects corrupted downloads without publishing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-recovery-cli-'));
  const bytes = Buffer.from('verified isolated recording');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const authenticate = authenticator(key);
  let corrupt = false,
    redirect = false;
  const server = createServer((request, response) => {
    if (!authenticate(request)) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/recordings/' + id) response.end(JSON.stringify({ id, digest }));
    else if (request.url === '/v1/blobs/' + digest) {
      if (redirect) response.writeHead(302, { location: '/redirected' }).end();
      else response.end(corrupt ? 'corrupted' : bytes);
    } else response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('missing_fixture_port');
  const node = { id: 'fixture', key, url: `http://127.0.0.1:${address.port}`, allowHttp: true };
  const kit = join(root, 'recovery.json');
  await writeFile(kit, JSON.stringify({ nodes: [node] }), { mode: 0o600 });
  const output = join(root, 'recording.mp4');
  const args = ['--kit', kit, '--node', 'fixture', '--recording', id, '--output', output];
  const messages: string[] = [];
  try {
    await recover(args, (value) => messages.push(value));
    expect(await readFile(output)).toEqual(bytes);
    expect(messages).toEqual(['Verified recording exported. No home configuration was changed.']);
    await expect(recover(args, () => {})).rejects.toThrow();
    expect(await readFile(output)).toEqual(bytes);
    await rm(output);
    corrupt = true;
    await expect(recover(args, () => {})).rejects.toThrow('recovery_checksum_mismatch');
    expect(await readdir(root)).toEqual(['recovery.json']);
    corrupt = false;
    redirect = true;
    await expect(recover(args, () => {})).rejects.toThrow();
    expect(await readdir(root)).toEqual(['recovery.json']);
    await writeFile(kit, JSON.stringify({ nodes: [{ ...node, allowHttp: false }] }));
    await expect(readRecoveryKit(kit, 'fixture')).rejects.toThrow('untrusted_recovery_address');
    await writeFile(kit, JSON.stringify({ nodes: [node, node] }));
    await expect(readRecoveryKit(kit, 'fixture')).rejects.toThrow('invalid_recovery_node');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
