/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { TestContext } from 'vitest';
import { vi } from 'vitest';
import { RecordingStore } from '../../src/events/recording.store.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { ClusterCatalog } from '../../src/cluster/catalog.js';
import { Cluster, type ClusterBackups } from '../../src/cluster/cluster.js';

export const sshServerId = 'ssh:98406f80-75ca-4c91-9633-23cc2f32a100';

export async function fixture(context: TestContext, roles: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'haus-server-enrollment-'));
  const media = join(root, 'media');
  await mkdir(media);
  const file = join(root, 'haus.sqlite');
  const source = await openCatalog(file);
  const transactions = new Transactions(source);
  const owners = [{ source, transactions }];
  const store = new RecordingStore(source, media, transactions);
  const bytes = Buffer.from('recovery-copy');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const backup = join(root, 'recovery.enc');
  await writeFile(backup, bytes);
  const requests: Array<string | undefined> = [],
    peers: Server[] = [];
  const changed = vi.fn();
  const backups: ClusterBackups = {
    list: () => [{ digest, bytes: bytes.length, kind: 'haus', createdAt: 1 }],
    path: () => backup,
    markChanged: changed,
    retry: () => undefined,
    canSnapshot: () => false,
    snapshot: async () => {
      throw Error('unexpected_fixture_snapshot');
    },
  };
  const cluster = new Cluster(store, backups, { catalog: new ClusterCatalog(transactions) });
  const clusters = [cluster];
  context.onTestFinished(async () => {
    vi.restoreAllMocks();
    await Promise.all(clusters.map((owner) => owner.stop()));
    await store.close();
    for (const owner of owners) {
      await owner.transactions.drain();
      if (owner.source.isInitialized) await owner.source.destroy();
    }
    await Promise.all(
      peers.map(async (server) => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }),
    );
    await rm(root, { recursive: true, force: true });
  });
  await cluster.initialize();
  const addPeer = async (
    status: Record<string, unknown> = {},
    handle?: (request: IncomingMessage, response: ServerResponse) => void,
  ) => {
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (req.url !== '/v1/status') {
        if (handle) return handle(req, res);
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          protocol: 1,
          nodeId: 'monitor-fixture',
          instanceId: 'monitor-instance',
          roles,
          storage: { usedBytes: 0, maxBytes: 10000 },
          streams: { active: 0, max: 0 },
          host: { scope: 'host', sampledAt: new Date().toISOString(), cpu: { usage: 0.2 } },
          ...status,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    peers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('missing_fixture_listener');
    return `http://127.0.0.1:${address.port}`;
  };
  const independent = async () => {
    const other = await openCatalog(file);
    const tx = new Transactions(other);
    owners.push({ source: other, transactions: tx });
    const owner = new Cluster(store, backups, { catalog: new ClusterCatalog(tx) });
    clusters.push(owner);
    await owner.initialize();
    return { cluster: owner, transactions: tx };
  };
  const input = (url: string, extra: Record<string, unknown> = {}) => ({
    name: 'Monitoring fixture',
    url,
    key: 'fixture-key-'.repeat(4),
    roles,
    allowHttp: true,
    ...extra,
  });
  return {
    cluster,
    addPeer,
    requests,
    input,
    source,
    file,
    store,
    transactions,
    independent,
    changed,
  };
}
