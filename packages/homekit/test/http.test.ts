/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { parseHttpMessages } from '../src/hap-client/http.js';

it('preserves fragmented bodies and separates HAP responses from event messages', () => {
  const response = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello');
  const partial = response.subarray(0, response.length - 1);
  expect(parseHttpMessages(partial)).toEqual({ messages: [], remainder: partial });
  const event = Buffer.from('EVENT/1.0 200 OK\r\nContent-Length: 2\r\n\r\n{}');
  const remainder = Buffer.from('HTTP/1.1 ');
  const parsed = parseHttpMessages(Buffer.concat([response, event, remainder]));
  expect(
    parsed.messages.map(({ protocol, statusCode, body }) => [
      protocol,
      statusCode,
      body.toString(),
    ]),
  ).toEqual([
    ['HTTP/1.1', 200, 'hello'],
    ['EVENT/1.0', 200, '{}'],
  ]);
  expect(parsed.remainder).toEqual(remainder);
});

it('keeps an incomplete chunked response until the final chunk arrives', () => {
  const initial = Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n');
  expect(parseHttpMessages(initial)).toEqual({ messages: [], remainder: initial });
  const complete = parseHttpMessages(Buffer.concat([initial, Buffer.from('2\r\nde\r\n0\r\n\r\n')]));
  expect(complete.messages).toHaveLength(1);
  expect(complete.messages[0]?.body.toString()).toBe('abcde');
  expect(complete.remainder.byteLength).toBe(0);
});
