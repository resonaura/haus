import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { fetchMedia } from './media-fetch';
it('times out stalled NVR headers while allowing an advancing body to outlive that deadline', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/stall') return;
    response.writeHead(200).flushHeaders();
    setTimeout(() => response.end('video'), 750);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture listener');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await expect(fetchMedia(`${base}/stall`, {}, 25)).rejects.toThrow();
    const response = await fetchMedia(`${base}/body`, {}, 500);
    expect(await response.text()).toBe('video');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
