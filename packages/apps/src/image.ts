/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppArchitecture, AppBuildRecipe, AppManifest } from './manifest.js';

export interface DockerHostPlatform {
  readonly os: string;
  readonly architecture: string;
  readonly variant?: string;
}

export interface DockerImageInspection {
  readonly id: string;
  readonly os?: string;
  readonly architecture?: string;
  readonly variant?: string;
  readonly repoDigests?: readonly string[];
}

export interface DockerImageProgress {
  readonly current?: number;
  readonly total?: number;
}

export interface DockerImageEngine {
  getHostPlatform(signal?: AbortSignal): Promise<DockerHostPlatform>;
  inspectImage(reference: string, signal?: AbortSignal): Promise<DockerImageInspection | undefined>;
  pullImage(
    reference: string,
    platform: string,
    onProgress: (progress: DockerImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  buildImage(
    recipe: AppBuildRecipe,
    target: string,
    onProgress: (progress: DockerImageProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

export type AppImageSource = 'local' | 'registry' | 'build';

export interface ResolvedAppImage {
  readonly reference: string;
  readonly imageId: string;
  /** Registry digest when available, otherwise Docker's content-addressed image ID. */
  readonly digest: string;
  readonly source: AppImageSource;
  readonly platform: string;
}

export type AppImageStage = 'checking-local' | 'pulling' | 'building' | 'ready';

export interface AppImageProgress {
  readonly stage: AppImageStage;
  readonly current?: number;
  readonly total?: number;
}

export class AppImageAcquisitionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AppImageAcquisitionError';
  }
}

function cancelled(): AppImageAcquisitionError {
  return new AppImageAcquisitionError('app_operation_cancelled');
}

function runAbortable<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(cancelled());
  if (!signal) {
    try {
      return operation();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });

    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      if (!settled) {
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? cancelled() : error);
      }
      return;
    }

    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(cancelled());
        else resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? cancelled() : error);
      },
    );
  });
}

const DOCKER_ARCHITECTURES: Readonly<Record<string, AppArchitecture>> = {
  amd64: 'amd64',
  x86_64: 'amd64',
  arm64: 'arm64',
  aarch64: 'arm64',
  armv7: 'armv7',
  armv7l: 'armv7',
  'arm/v7': 'armv7',
  '386': 'i386',
  i386: 'i386',
  i686: 'i386',
};

function normalizeArchitecture(
  architecture: string,
  variant?: string,
): AppArchitecture | undefined {
  const normalized = architecture.toLowerCase();
  if (normalized === 'arm' && variant?.toLowerCase() === 'v7') return 'armv7';
  return DOCKER_ARCHITECTURES[normalized];
}

function platformReference(architecture: AppArchitecture): string {
  return architecture === 'armv7'
    ? 'linux/arm/v7'
    : `linux/${architecture === 'i386' ? '386' : architecture}`;
}

function matchesPlatform(image: DockerImageInspection, platform: AppArchitecture): boolean {
  if (image.os?.toLowerCase() !== 'linux') return false;
  return normalizeArchitecture(image.architecture ?? '', image.variant) === platform;
}

function resolveImage(
  image: DockerImageInspection,
  source: AppImageSource,
  platform: string,
): ResolvedAppImage {
  if (!/^sha256:[a-f0-9]{64}$/i.test(image.id))
    throw new AppImageAcquisitionError('docker_image_inspect_invalid');
  const digest =
    image.repoDigests?.find((value) => /@sha256:[a-f0-9]{64}$/i.test(value)) ?? image.id;
  return { reference: image.id, imageId: image.id, digest, source, platform };
}

function localBuildTag(manifest: AppManifest): string | undefined {
  if (!manifest.build) return undefined;
  return `haus-local/${manifest.id}:${manifest.build.commit.slice(0, 12).toLowerCase()}`;
}

/** Return true when a container image reference uses a mutable tag (such as `:latest` or untagged). */
export function isMutableImageTag(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed || /@sha256:[a-f0-9]{64}$/i.test(trimmed)) return false;
  const lastSlash = trimmed.lastIndexOf('/');
  const tail = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  const colon = tail.lastIndexOf(':');
  if (colon === -1) return true;
  return tail.slice(colon + 1).toLowerCase() === 'latest';
}

/** Selects a compatible cached image, pulls the published artifact, then uses an explicit source recipe. */
export class AppImageAcquirer {
  constructor(private readonly engine: DockerImageEngine) {}

  async acquire(
    manifest: AppManifest,
    onProgress: (progress: AppImageProgress) => void = () => undefined,
    signal?: AbortSignal,
  ): Promise<ResolvedAppImage> {
    onProgress({ stage: 'checking-local' });
    const host = await runAbortable(signal, () => this.engine.getHostPlatform(signal));
    if (host.os.toLowerCase() !== 'linux')
      throw new AppImageAcquisitionError('unsupported_app_host_os');
    const architecture = normalizeArchitecture(host.architecture, host.variant);
    if (!architecture) throw new AppImageAcquisitionError('unsupported_app_host_architecture');
    if (!manifest.architectures.includes(architecture)) {
      throw new AppImageAcquisitionError('app_unsupported_architecture');
    }

    const platform = platformReference(architecture);
    const buildTag = localBuildTag(manifest);
    const localReferences = [...new Set([manifest.image, ...(buildTag ? [buildTag] : [])])];
    const inspectLocal = async (): Promise<ResolvedAppImage | undefined> => {
      for (const reference of localReferences) {
        const image = await runAbortable(signal, () => this.engine.inspectImage(reference, signal));
        if (image && matchesPlatform(image, architecture)) {
          const resolved = resolveImage(image, 'local', platform);
          onProgress({ stage: 'ready' });
          return resolved;
        }
      }
      return undefined;
    };

    // Pull mutable tags (:latest / untagged) before trusting cached local layers; fall back offline.
    const preferRemotePull = !buildTag && isMutableImageTag(manifest.image);
    if (!preferRemotePull) {
      const local = await inspectLocal();
      if (local) return local;
    }

    let registryFailure = 'app_registry_image_unavailable';
    let pullThrew = false;
    onProgress({ stage: 'pulling' });
    try {
      await runAbortable(signal, () =>
        this.engine.pullImage(
          manifest.image,
          platform,
          (progress) => {
            if (!signal?.aborted) onProgress({ stage: 'pulling', ...progress });
          },
          signal,
        ),
      );
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      pullThrew = true;
      const code = error instanceof Error ? error.message : '';
      if (
        ['docker_unavailable', 'docker_request_timeout', 'docker_operation_not_allowed'].includes(
          code,
        )
      ) {
        throw new AppImageAcquisitionError(code);
      }
      if (/^[a-z][a-z0-9_]{0,79}$/.test(code)) registryFailure = code;
    }

    if (!pullThrew && registryFailure === 'app_registry_image_unavailable') {
      const pulled = await runAbortable(signal, () =>
        this.engine.inspectImage(manifest.image, signal),
      );
      if (pulled && matchesPlatform(pulled, architecture)) {
        const resolved = resolveImage(pulled, 'registry', platform);
        onProgress({ stage: 'ready' });
        return resolved;
      }
      registryFailure = 'app_registry_image_platform_mismatch';
    }

    if (preferRemotePull && pullThrew) {
      const localFallback = await inspectLocal();
      if (localFallback) return localFallback;
    }

    if (!manifest.build) throw new AppImageAcquisitionError(registryFailure);

    onProgress({ stage: 'building' });
    try {
      const recipe = manifest.build;
      const target = buildTag;
      if (!target) throw new AppImageAcquisitionError('app_build_recipe_missing');
      await runAbortable(signal, () =>
        this.engine.buildImage(
          recipe,
          target,
          (progress) => {
            if (!signal?.aborted) onProgress({ stage: 'building', ...progress });
          },
          signal,
        ),
      );
      const built = await runAbortable(signal, () => this.engine.inspectImage(target, signal));
      if (!built || !matchesPlatform(built, architecture)) {
        throw new AppImageAcquisitionError('app_build_image_platform_mismatch');
      }
      const resolved = resolveImage(built, 'build', platform);
      onProgress({ stage: 'ready' });
      return resolved;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error instanceof AppImageAcquisitionError) throw error;
      throw new AppImageAcquisitionError('app_build_failed');
    }
  }
}
