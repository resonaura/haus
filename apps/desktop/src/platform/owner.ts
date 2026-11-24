/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

export interface SessionOwnerOptions {
  readonly platform?: NodeJS.Platform;
  readonly lockFileDescriptor?: (fd: number, platform: NodeJS.Platform) => boolean;
}

const LOCK_EX_NB = 2 | 4;
const LOCKFILE_EXCLUSIVE_AND_FAIL_IMMEDIATELY = 0x0000_0001 | 0x0000_0002;
const INVALID_WIN32_HANDLE = -1n;

async function lockPosixFd(fd: number, platform: NodeJS.Platform): Promise<boolean> {
  const koffi = await import('koffi');
  const system = koffi.load(platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : null);
  const flock = system.func('int flock(int fd, int operation)');
  return flock(fd, LOCK_EX_NB) === 0;
}

function loadFirstAvailableLibrary(
  koffi: typeof import('koffi'),
  candidates: readonly string[],
): ReturnType<typeof koffi.load> {
  let lastError: unknown;
  for (const name of candidates) {
    try {
      return koffi.load(name);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Required Windows lock runtime missing.');
}

async function lockWindowsFd(fd: number): Promise<boolean> {
  const koffi = await import('koffi');
  const crt = loadFirstAvailableLibrary(koffi, ['ucrtbase.dll', 'msvcrt.dll']);
  const kernel32 = koffi.load('kernel32.dll');
  const getOsfHandle = crt.func('intptr_t _get_osfhandle(int fd)');
  const overlappedType = koffi.struct({
    Internal: 'uintptr_t',
    InternalHigh: 'uintptr_t',
    Offset: 'uint32_t',
    OffsetHigh: 'uint32_t',
    hEvent: 'void *',
  });
  const lockFileEx = kernel32.func(
    'int __stdcall LockFileEx(intptr_t hFile, uint32_t dwFlags, uint32_t dwReserved, uint32_t nNumberOfBytesToLockLow, uint32_t nNumberOfBytesToLockHigh, void *lpOverlapped)',
  );
  const handle = BigInt(getOsfHandle(fd));
  if (handle === INVALID_WIN32_HANDLE) return false;
  const overlapped = koffi.alloc(overlappedType, 1);
  try {
    return (
      lockFileEx(handle, LOCKFILE_EXCLUSIVE_AND_FAIL_IMMEDIATELY, 0, 1, 0, overlapped) !== 0
    );
  } finally {
    koffi.free(overlapped);
  }
}

export async function acquireHubSessionOwner(
  directory: string,
  options: SessionOwnerOptions = {},
): Promise<FileHandle> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error('Haus GPUIX session ownership is only supported on macOS, Windows, and Linux.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const owner = await open(join(directory, 'hub-session.lock'), 'a+', 0o600);
  try {
    const acquired = options.lockFileDescriptor
      ? options.lockFileDescriptor(owner.fd, platform)
      : platform === 'win32'
        ? await lockWindowsFd(owner.fd)
        : await lockPosixFd(owner.fd, platform);
    // OS kernel releases POSIX flock / Windows LockFileEx when the descriptor closes or exits.
    if (acquired) return owner;
  } catch (error) {
    await owner.close().catch(() => undefined);
    throw error;
  }
  await owner.close();
  throw new Error('Another Haus GPUIX process owns the Hub session.');
}
