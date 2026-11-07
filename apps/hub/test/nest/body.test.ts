/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { expect, it } from 'vitest';
import { requestBody } from '../../src/http/body.js';

function request(chunks: readonly Buffer[]): IncomingMessage {
  const message = new IncomingMessage(new Socket());
  message.headers = { 'content-type': 'application/json', 'x-haus-client': '1' };
  message[Symbol.asyncIterator] = async function* (): AsyncGenerator<Buffer, undefined, unknown> {
    yield* chunks;
    return undefined;
  };
  return message;
}

it('decodes a UTF-8 character split across incoming chunks without changing its value', async () => {
  const bytes = Buffer.from('{"name":"Кухня"}');
  const firstByte = bytes.indexOf(Buffer.from('К'));
  expect(
    await requestBody(request([bytes.subarray(0, firstByte + 1), bytes.subarray(firstByte + 1)])),
  ).toEqual({ name: 'Кухня' });
});

it('bounds bytes at 64 KiB, rejects invalid JSON and enforces the client/content guards', async () => {
  expect(await requestBody(request([Buffer.from('"' + 'x'.repeat(65534) + '"')]))).toHaveLength(
    65534,
  );
  await expect(requestBody(request([Buffer.alloc(65537)]))).rejects.toThrow('body_too_large');
  await expect(requestBody(request([Buffer.from('{')]))).rejects.toThrow('invalid_json');
  const untrusted = request([]);
  delete untrusted.headers['x-haus-client'];
  await expect(requestBody(untrusted)).rejects.toThrow('json_required');
});
