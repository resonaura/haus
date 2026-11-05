/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { request } from 'node:http';
import type { DockerPort } from './docker.js';

function isForbiddenHostBind(bind: string): boolean {
  const hostPart = bind.split(':')[0]?.trim() ?? '';
  if (!hostPart) return false;
  if (hostPart.includes('docker.sock')) return true;
  if (hostPart.includes('..')) return true;
  const normalized = hostPart.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return ['/', '/etc', '/proc', '/sys', '/root', '/var/run', '/run', '/dev'].includes(normalized);
}

function inspectPayloadSafety(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  const raw = body as Record<string, unknown>;
  const hostConfig = raw.HostConfig as Record<string, unknown> | undefined;
  if (hostConfig && Array.isArray(hostConfig.Binds)) {
    for (const bind of hostConfig.Binds) {
      if (typeof bind === 'string' && isForbiddenHostBind(bind)) {
        return false;
      }
    }
  }
  return true;
}

/** Explicit local host permission. Only the driver's closed set of Docker operations is accepted. */
export class DockerSocket implements DockerPort {
  constructor(private readonly socketPath: string) {
    if (!socketPath.startsWith('/') || socketPath.includes('\0') || socketPath.length > 1024)
      throw Error('invalid_docker_socket');
  }
  request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    bodyOrSignal?: unknown,
    maybeSignal?: AbortSignal,
  ): Promise<T> {
    const isSignal =
      bodyOrSignal instanceof AbortSignal ||
      (typeof bodyOrSignal === 'object' &&
        bodyOrSignal !== null &&
        'aborted' in bodyOrSignal &&
        'addEventListener' in bodyOrSignal);
    const signal = isSignal ? (bodyOrSignal as AbortSignal) : maybeSignal;
    const body = isSignal ? undefined : bodyOrSignal;

    const read =
      method === 'GET' &&
      (path === '/version' ||
        /^\/v1\.\d+\/containers\/json(?:\?.*)?$/.test(path) ||
        /^\/v1\.\d+\/containers\/[a-f0-9]{64}\/json$/.test(path));
    const write =
      method === 'POST' &&
      (/^\/v1\.\d+\/containers\/create(?:\?.*)?$/.test(path) ||
        /^\/v1\.\d+\/containers\/[a-f0-9]{64}\/(?:start|stop|restart)$/.test(path));
    const del = method === 'DELETE' && /^\/v1\.\d+\/containers\/[a-f0-9]{64}(?:\?.*)?$/.test(path);

    if (!read && !write && !del) return Promise.reject(Error('docker_operation_not_allowed'));
    if (write && path.includes('/containers/create') && !inspectPayloadSafety(body)) {
      return Promise.reject(Error('docker_operation_not_allowed'));
    }

    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {};
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }
      const req = request(
        { socketPath: this.socketPath, method, path, headers, signal, timeout: 15000 },
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
              const resBody = Buffer.concat(chunks).toString('utf8');
              resolve((resBody.trim() ? JSON.parse(resBody) : undefined) as T);
            } catch {
              reject(Error('invalid_docker_response'));
            }
          });
        },
      );
      req.once('timeout', () => req.destroy(Error('docker_request_timeout')));
      req.once('error', () => reject(Error('docker_unavailable')));
      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }
}
