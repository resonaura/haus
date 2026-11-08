/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { MatterWsTransport } from '../src/ws-transport.js';

describe('@haus/matter — MatterWsTransport', () => {
  async function withMockServer(
    handler: (ws: WebSocket, reqMsg: Record<string, unknown>) => void,
    fn: (url: string) => Promise<void>,
  ): Promise<void> {
    const server = createServer();
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      // Send initial handshake frame
      ws.send(JSON.stringify({ sdk_version: 'matter.js/0.18.0' }));

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        handler(ws, msg);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    try {
      await fn(url);
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('connects to server and executes device_command for on/off', async () => {
    await withMockServer(
      (ws, msg) => {
        if (msg.command === 'device_command') {
          ws.send(JSON.stringify({ message_id: msg.message_id, result: { success: true } }));
        }
      },
      async (url) => {
        const transport = new MatterWsTransport({ url });
        await transport.connect();

        const res = await transport.sendCommand('1', 7, 6, 1);
        expect(res).toEqual({ success: true });

        transport.close();
      },
    );
  });

  it('subscribes to attribute updates and emits MatterAttributeChange', async () => {
    await withMockServer(
      (ws, msg) => {
        if (msg.command === 'trigger_event') {
          ws.send(
            JSON.stringify({
              event: 'attribute_updated',
              data: [1, '7/6/0', true],
            }),
          );
          ws.send(JSON.stringify({ message_id: msg.message_id, result: 'ok' }));
        }
      },
      async (url) => {
        const transport = new MatterWsTransport({ url });
        await transport.connect();

        let receivedChange: unknown = null;
        const unsubscribe = transport.subscribe((change) => {
          receivedChange = change;
        });

        // Trigger event via server
        // @ts-expect-error test helper
        await transport.sendRequest('trigger_event');

        expect(receivedChange).toEqual(
          expect.objectContaining({
            nodeId: '1',
            endpointId: 7,
            clusterId: 6,
            attributeId: 0,
            value: true,
          }),
        );

        unsubscribe();
        transport.close();
      },
    );
  });
});
