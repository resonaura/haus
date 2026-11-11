/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface HttpMessage {
  readonly protocol: 'HTTP/1.1' | 'EVENT/1.0';
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export function parseHttpMessages(buffer: Buffer): { messages: HttpMessage[]; remainder: Buffer } {
  const messages: HttpMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'ascii');
    if (headerEnd === -1) break;

    const headerStr = buffer.subarray(offset, headerEnd).toString('ascii');
    const lines = headerStr.split('\r\n');
    const firstLine = lines[0] ?? '';
    const parts = firstLine.split(' ');
    const protocol = parts[0] === 'EVENT/1.0' ? 'EVENT/1.0' : 'HTTP/1.1';
    const statusCode = parseInt(parts[1] ?? '200', 10);

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx > 0) {
        headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
      }
    }

    const bodyStart = headerEnd + 4;
    if (headers['transfer-encoding']?.toLowerCase() === 'chunked') {
      let chunkPos = bodyStart;
      const chunks: Buffer[] = [];
      let complete = false;
      while (chunkPos < buffer.length) {
        const lineEnd = buffer.indexOf('\r\n', chunkPos, 'ascii');
        if (lineEnd === -1) break;
        const sizeHex = buffer.subarray(chunkPos, lineEnd).toString('ascii').split(';')[0].trim();
        const chunkSize = parseInt(sizeHex, 16);
        if (Number.isNaN(chunkSize)) break;
        if (chunkSize === 0) {
          if (lineEnd + 4 <= buffer.length) {
            offset = lineEnd + 4;
            complete = true;
          }
          break;
        }
        const chunkDataStart = lineEnd + 2;
        const chunkDataEnd = chunkDataStart + chunkSize;
        if (chunkDataEnd + 2 > buffer.length) break;
        chunks.push(buffer.subarray(chunkDataStart, chunkDataEnd));
        chunkPos = chunkDataEnd + 2;
      }
      if (!complete) break;
      messages.push({ protocol, statusCode, headers, body: Buffer.concat(chunks) });
    } else {
      const contentLength = parseInt(headers['content-length'] ?? '0', 10);
      if (bodyStart + contentLength > buffer.length) break;
      const body = buffer.subarray(bodyStart, bodyStart + contentLength);
      offset = bodyStart + contentLength;
      messages.push({ protocol, statusCode, headers, body });
    }
  }

  return { messages, remainder: Buffer.from(buffer.subarray(offset)) };
}
