/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';

export interface IngressRouteConfig {
  ingressPath: string; // e.g. "/api/ingress/zigbee2mqtt"
  targetHost: string; // e.g. "127.0.0.1" or container IP
  targetPort: number; // e.g. 8099
}

export class IngressProxy {
  private routes = new Map<string, IngressRouteConfig>();

  registerRoute(config: IngressRouteConfig): void {
    const normalized = this.normalizePath(config.ingressPath);
    this.routes.set(normalized, { ...config, ingressPath: normalized });
  }

  unregisterRoute(ingressPath: string): void {
    this.routes.delete(this.normalizePath(ingressPath));
  }

  private normalizePath(path: string): string {
    const trimmed = path.trim().replace(/\/+$/, '');
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  findRoute(urlPath: string): { route: IngressRouteConfig; subpath: string } | undefined {
    for (const [prefix, route] of this.routes) {
      if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) {
        const subpath = urlPath.slice(prefix.length) || '/';
        return { route, subpath };
      }
    }
    return undefined;
  }

  handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = this.findRoute(url.pathname);
    if (!match) return false;

    const { route, subpath } = match;
    const targetUrl = `${subpath}${url.search}`;

    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: `${route.targetHost}:${route.targetPort}`,
      'x-forwarded-host': req.headers.host ?? 'localhost',
      'x-forwarded-proto': 'http',
      'x-ingress-path': route.ingressPath,
    };

    const proxyReq = httpRequest(
      {
        host: route.targetHost,
        port: route.targetPort,
        method: req.method,
        path: targetUrl,
        headers,
      },
      (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] ?? '';
        const isHtml = typeof contentType === 'string' && contentType.includes('text/html');

        if (isHtml) {
          // Buffer HTML to inject base tag for subpath asset resolution
          const chunks: Buffer[] = [];
          proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          proxyRes.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf-8');
            const baseTag = `<base href="${route.ingressPath}/">`;
            if (html.includes('<head>') && !html.includes('<base ')) {
              html = html.replace('<head>', `<head>\n  ${baseTag}`);
            } else if (html.includes('<head ') && !html.includes('<base ')) {
              html = html.replace(/(<head[^>]*>)/i, `$1\n  ${baseTag}`);
            }

            const responseHeaders = { ...proxyRes.headers };
            delete responseHeaders['content-length'];
            delete responseHeaders['transfer-encoding'];
            responseHeaders['content-length'] = Buffer.byteLength(html, 'utf-8').toString();

            res.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
            res.end(html);
          });
        } else {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      },
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
      }
    });

    req.pipe(proxyReq);
    return true;
  }

  handleUpgrade(req: IncomingMessage, clientSocket: Socket, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = this.findRoute(url.pathname);
    if (!match) return false;

    const { route, subpath } = match;
    const targetUrl = `${subpath}${url.search}`;

    const targetSocket = netConnect(route.targetPort, route.targetHost, () => {
      const headers = [
        `${req.method} ${targetUrl} HTTP/1.1`,
        `Host: ${route.targetHost}:${route.targetPort}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `X-Ingress-Path: ${route.ingressPath}`,
      ];

      for (const [key, value] of Object.entries(req.headers)) {
        if (
          key.toLowerCase() === 'host' ||
          key.toLowerCase() === 'connection' ||
          key.toLowerCase() === 'upgrade'
        ) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const v of value) headers.push(`${key}: ${v}`);
        } else if (value !== undefined) {
          headers.push(`${key}: ${value}`);
        }
      }

      headers.push('', '');
      targetSocket.write(headers.join('\r\n'));
      if (head.length > 0) targetSocket.write(head);

      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.on('error', () => {
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      targetSocket.destroy();
    });

    return true;
  }
}
