/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { request } from 'node:http';
import type { DockerPort } from './docker.js';

/** Explicit local host permission. Only the driver's closed set of Docker operations is accepted. */
export class DockerSocket implements DockerPort {
  constructor(private readonly socketPath: string) {
    if (!socketPath.startsWith('/') || socketPath.includes('\0') || socketPath.length > 1024)
      throw Error('invalid_docker_socket');
  }
  request<T>(method: 'GET' | 'POST', path: string, signal?: AbortSignal): Promise<T> {
    const read =
      method === 'GET' &&
      (path === '/version' || /^\/v1\.\d+\/containers\/json\?all=1$/.test(path));
    const write =
      method === 'POST' &&
      /^\/v1\.\d+\/containers\/[a-f0-9]{64}\/(?:start|stop|restart)$/.test(path);
    if (!read && !write) return Promise.reject(Error('docker_operation_not_allowed'));
    return new Promise((resolve, reject) => {
      const req = request(
        { socketPath: this.socketPath, method, path, signal, timeout: 15000 },
        (response) => {
          if (!response.statusCode || response.statusCode >= 400) {
            response.destroy();
            reject(Error('docker_request_failed'));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 4 * 1024 * 1024) {
              req.destroy(Error('docker_response_limit'));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.once('error', () => reject(Error('docker_request_failed')));
          response.once('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              resolve((body.trim() ? JSON.parse(body) : undefined) as T);
            } catch {
              reject(Error('invalid_docker_response'));
            }
          });
        },
      );
      req.once('timeout', () => req.destroy(Error('docker_request_timeout')));
      req.once('error', () => reject(Error('docker_unavailable')));
      req.end();
    });
  }
}
