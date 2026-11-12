/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { request } from 'node:http';
import type { DockerPort } from './docker.js';
import type { AppBuildRecipe } from './manifest.js';
import type {
  DockerHostPlatform,
  DockerImageEngine,
  DockerImageInspection,
  DockerImageProgress,
} from './image.js';

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
const PLATFORM_REFERENCES = new Set(['linux/amd64', 'linux/arm64', 'linux/arm/v7', 'linux/386']);
const IMAGE_REFERENCE =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
const BUILD_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

function validImageReference(reference: string): boolean {
  return (
    IMAGE_REFERENCE.test(reference) &&
    !reference.includes('//') &&
    !reference.split('/').some((part) => part === '.' || part === '..')
  );
}

function validBuildPath(path: string): boolean {
  return (
    /^(?:\.|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/.test(path) &&
    (path === '.' || path.split('/').every((part) => part !== '.' && part !== '..'))
  );
}

interface DockerInfoResponse {
  OSType?: string;
  Architecture?: string;
  Variant?: string;
}

interface DockerImageInspectResponse {
  Id?: string;
  Os?: string;
  Architecture?: string;
  Variant?: string;
  RepoDigests?: string[];
}

interface DockerProgressResponse {
  error?: string;
  errorDetail?: { message?: string };
  progressDetail?: { current?: number; total?: number };
}

export class DockerSocket implements DockerPort, DockerImageEngine {
  constructor(private readonly socketPath: string) {
    if (!socketPath.startsWith('/') || socketPath.includes('\0') || socketPath.length > 1024)
      throw Error('invalid_docker_socket');
  }

  async getHostPlatform(signal?: AbortSignal): Promise<DockerHostPlatform> {
    const info = await this.request<DockerInfoResponse>('GET', '/v1.45/info', signal);
    if (!info?.OSType || !info.Architecture) throw Error('docker_host_platform_unavailable');
    return { os: info.OSType, architecture: info.Architecture, variant: info.Variant };
  }

  async inspectImage(
    reference: string,
    signal?: AbortSignal,
  ): Promise<DockerImageInspection | undefined> {
    if (!validImageReference(reference)) throw Error('invalid_docker_image_reference');
    try {
      const image = await this.request<DockerImageInspectResponse>(
        'GET',
        `/v1.45/images/${reference}/json`,
        signal,
      );
      if (!image?.Id) throw Error('docker_image_inspect_invalid');
      return {
        id: image.Id,
        os: image.Os,
        architecture: image.Architecture,
        variant: image.Variant,
        repoDigests: image.RepoDigests,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'docker_image_not_found') return undefined;
      throw error;
    }
  }

  async pullImage(
    reference: string,
    platform: string,
    onProgress: (progress: DockerImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!validImageReference(reference) || !PLATFORM_REFERENCES.has(platform)) {
      throw Error('invalid_docker_image_request');
    }
    const query = new URLSearchParams({ fromImage: reference, platform });
    await this.streamImageOperation(
      `/v1.45/images/create?${query.toString()}`,
      'pull',
      onProgress,
      signal,
    );
  }

  async buildImage(
    recipe: AppBuildRecipe,
    target: string,
    onProgress: (progress: DockerImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !BUILD_REPOSITORY.test(recipe.repository) ||
      !/^[a-f0-9]{40}$/i.test(recipe.commit) ||
      !validImageReference(target) ||
      (recipe.context !== undefined && !validBuildPath(recipe.context)) ||
      (recipe.dockerfile !== undefined && !validBuildPath(recipe.dockerfile))
    ) {
      throw Error('invalid_docker_build_recipe');
    }
    const repository = recipe.repository.endsWith('.git')
      ? recipe.repository
      : `${recipe.repository}.git`;
    const context = recipe.context && recipe.context !== '.' ? `:${recipe.context}` : '';
    const remote = `${repository}#${recipe.commit.toLowerCase()}${context}`;
    const query = new URLSearchParams({ remote, t: target });
    if (recipe.dockerfile) query.set('dockerfile', recipe.dockerfile);
    await this.streamImageOperation(
      `/v1.45/build?${query.toString()}`,
      'build',
      onProgress,
      signal,
    );
  }

  private streamImageOperation(
    path: string,
    operation: 'pull' | 'build',
    onProgress: (progress: DockerImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const errorCode =
      operation === 'pull' ? 'docker_image_pull_failed' : 'docker_image_build_failed';
    const validPath =
      operation === 'pull'
        ? /^\/v1\.\d+\/images\/create\?fromImage=[^&]+&platform=linux%2F(?:amd64|arm64|386|arm%2Fv7)$/.test(
            path,
          )
        : /^\/v1\.\d+\/build\?remote=https?%3A%2F%2Fgithub\.com%2F[^&]+&t=[^&]+/.test(path);
    if (!validPath) return Promise.reject(Error('docker_operation_not_allowed'));

    return new Promise((resolve, reject) => {
      let settled = false;
      let pending = '';
      let bytes = 0;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finish = () => {
        if (settled) return;
        if (pending.trim()) {
          try {
            this.readProgressLine(pending, operation, onProgress);
          } catch (error) {
            fail(error instanceof Error ? error : Error(errorCode));
            return;
          }
        }
        settled = true;
        resolve();
      };
      const req = request(
        { socketPath: this.socketPath, method: 'POST', path, signal, timeout: 300000 },
        (response) => {
          if (!response.statusCode || response.statusCode >= 400) {
            response.resume();
            const code =
              response.statusCode === 401 || response.statusCode === 403
                ? 'docker_registry_auth_failed'
                : errorCode;
            fail(Error(code));
            return;
          }
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 64 * 1024 * 1024) {
              req.destroy(Error('docker_progress_limit'));
              return;
            }
            pending += chunk;
            if (pending.length > 1024 * 1024 && !pending.includes('\n')) {
              req.destroy(Error('docker_progress_line_limit'));
              return;
            }
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
              try {
                this.readProgressLine(line, operation, onProgress);
              } catch (error) {
                fail(error instanceof Error ? error : Error(errorCode));
                req.destroy();
                return;
              }
            }
          });
          response.once('error', () => fail(Error(errorCode)));
          response.once('end', finish);
        },
      );
      req.once('timeout', () => {
        fail(Error('docker_request_timeout'));
        req.destroy();
      });
      req.once('error', () => fail(Error('docker_unavailable')));
      req.end();
    });
  }

  private readProgressLine(
    line: string,
    operation: 'pull' | 'build',
    onProgress: (progress: DockerImageProgress) => void,
  ): void {
    if (!line.trim()) return;
    let event: DockerProgressResponse;
    try {
      event = JSON.parse(line) as DockerProgressResponse;
    } catch {
      throw Error('invalid_docker_progress');
    }
    if (event.error || event.errorDetail?.message) {
      throw Error(operation === 'pull' ? 'docker_image_pull_failed' : 'docker_image_build_failed');
    }
    const current = event.progressDetail?.current;
    const total = event.progressDetail?.total;
    if (
      (current === undefined || (Number.isFinite(current) && current >= 0)) &&
      (total === undefined || (Number.isFinite(total) && total >= 0)) &&
      (current !== undefined || total !== undefined)
    ) {
      onProgress({ current, total });
    }
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
    const imageInspect = path.match(/^\/v1\.\d+\/images\/(.+)\/json$/);

    const read =
      method === 'GET' &&
      (path === '/version' ||
        /^\/v1\.\d+\/info$/.test(path) ||
        /^\/v1\.\d+\/containers\/json(?:\?.*)?$/.test(path) ||
        /^\/v1\.\d+\/containers\/[a-f0-9]{64}\/json$/.test(path) ||
        Boolean(imageInspect && validImageReference(imageInspect[1] ?? '')));
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
            const code =
              method === 'GET' && response.statusCode === 404 && path.includes('/images/')
                ? 'docker_image_not_found'
                : 'docker_request_failed';
            response.destroy();
            reject(Error(code));
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
