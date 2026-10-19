import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { resilientMediaBody } from './media-body';
it('resumes a dropped NVR response at the next byte without repeating footage', async () => {
  const bytes = Buffer.from('a complete recording');
  const requests: string[] = [];
  const server = createServer((request, response) => {
    if (!request.headers.range) {
      response.writeHead(200, { 'Content-Length': bytes.length });
      response.write(bytes.subarray(0, 5));
      setTimeout(() => response.destroy(), 40);
    } else {
      requests.push(request.headers.range);
      const start = Number(/bytes=(\d+)-/.exec(request.headers.range)![1]);
      response
        .writeHead(206, {
          'Content-Length': bytes.length - start,
          'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
        })
        .end(bytes.subarray(start));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture listener');
  const url = `http://127.0.0.1:${address.port}/clip`;
  try {
    const original = await fetch(url);
    const stream = resilientMediaBody(
      original,
      (start, end, signal) => fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal }),
      new AbortController().signal,
    );
    expect(await new Response(stream).text()).toBe(bytes.toString());
    expect(requests).toEqual([`bytes=5-${bytes.length - 1}`]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('rejects a range-ignoring continuation rather than duplicating the beginning', async () => {
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    }),
    { headers: { 'Content-Length': '4' } },
  );
  const stream = resilientMediaBody(
    interrupted,
    async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Length': '4' } }),
    new AbortController().signal,
  );
  await expect(new Response(stream).arrayBuffer()).rejects.toThrow('continuation');
});
