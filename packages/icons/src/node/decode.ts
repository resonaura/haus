/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { decodePngRgba, straightToPremultipliedRgba } from './png.js';

export interface DecodedPremulImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const PIL_HELPER_SCRIPT = `
import io, struct, sys
from PIL import Image
stdin = sys.stdin.buffer
stdout = sys.stdout.buffer
while True:
    hdr = stdin.read(4)
    if len(hdr) < 4:
        break
    (size,) = struct.unpack('>I', hdr)
    data = stdin.read(size)
    if len(data) < size:
        break
    try:
        im = Image.open(io.BytesIO(data)).convert('RGBA')
        if max(im.width, im.height) > 512:
            im.thumbnail((512, 512), Image.Resampling.LANCZOS)
        raw = im.tobytes()
        stdout.write(struct.pack('>III', im.width, im.height, len(raw)))
        stdout.write(raw)
        stdout.flush()
    except Exception:
        stdout.write(struct.pack('>III', 0, 0, 0))
        stdout.flush()
`;

interface PendingDecode {
  readonly resolve: (value: DecodedPremulImage | null) => void;
}

/**
 * Persistent single-process Python/Pillow bridge for non-PNG raster sources
 * (JPEG / WebP / ICO). PNG sources bypass this completely via native zlib.
 */
class PersistentRasterDecoder {
  private proc: ChildProcessByStdio<Writable, Readable, null> | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly queue: PendingDecode[] = [];
  private unavailable = false;

  private findPython(): string | null {
    const candidates = [process.env.HAUS_HA_PYTHON, '/opt/ha-venv/bin/python', 'python3'].filter(
      (v): v is string => Boolean(v),
    );
    for (const candidate of candidates) {
      if (candidate === 'python3' || existsSync(candidate)) return candidate;
    }
    return null;
  }

  private ensureProcess(): ChildProcessByStdio<Writable, Readable, null> | null {
    if (this.unavailable) return null;
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;

    const py = this.findPython();
    if (!py) {
      this.unavailable = true;
      return null;
    }
    const child = spawn(py, ['-u', '-c', PIL_HELPER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    child.on('error', () => {
      this.unavailable = true;
      this.failAll();
    });
    child.on('exit', () => {
      if (this.proc === child) this.proc = null;
      this.failAll();
    });
    this.proc = child;
    return child;
  }

  private drain(): void {
    while (this.queue.length > 0 && this.buffer.length >= 12) {
      const width = this.buffer.readUInt32BE(0);
      const height = this.buffer.readUInt32BE(4);
      const len = this.buffer.readUInt32BE(8);
      if (this.buffer.length < 12 + len) break;
      const raw = Buffer.from(this.buffer.subarray(12, 12 + len));
      this.buffer = this.buffer.subarray(12 + len);
      const next = this.queue.shift();
      if (!next) continue;
      if (width > 0 && height > 0 && raw.length === width * height * 4) {
        next.resolve({
          width,
          height,
          rgba: straightToPremultipliedRgba(raw),
        });
      } else {
        next.resolve(null);
      }
    }
  }

  private failAll(): void {
    this.buffer = Buffer.alloc(0);
    while (this.queue.length > 0) {
      this.queue.shift()?.resolve(null);
    }
  }

  decode(bytes: Uint8Array): Promise<DecodedPremulImage | null> {
    const child = this.ensureProcess();
    if (!child) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(bytes.length, 0);
      try {
        child.stdin.write(header);
        child.stdin.write(bytes);
      } catch {
        this.failAll();
      }
    });
  }

  dispose(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.proc = null;
    }
    this.failAll();
  }
}

const sharedDecoder = new PersistentRasterDecoder();

export function disposeRasterDecoder(): void {
  sharedDecoder.dispose();
}

export function parseImageDataUri(dataUri: string): { mime: string; bytes: Buffer } | null {
  const b64Match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri);
  if (b64Match) {
    return { mime: b64Match[1]!.toLowerCase(), bytes: Buffer.from(b64Match[2]!, 'base64') };
  }
  const utf8Match = /^data:(image\/svg\+xml);charset=utf-8,(.+)$/i.exec(dataUri);
  if (utf8Match) {
    try {
      return {
        mime: 'image/svg+xml',
        bytes: Buffer.from(decodeURIComponent(utf8Match[2]!), 'utf8'),
      };
    } catch {
      return null;
    }
  }
  return null;
}

function isPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

/**
 * Decodes raw image bytes (PNG fast-path via native zlib, JPEG/WebP via persistent Pillow worker)
 * into premultiplied RGBA ready for the icon engine. Returns null for SVG (handled on client or fallback).
 */
export async function decodeSourceToPremulRgba(
  bytes: Uint8Array,
  mime?: string,
): Promise<DecodedPremulImage | null> {
  if (bytes.length === 0) return null;
  if (mime === 'image/svg+xml') return null;

  if (mime === 'image/png' || isPngMagic(bytes)) {
    try {
      const decoded = decodePngRgba(bytes);
      return {
        width: decoded.width,
        height: decoded.height,
        rgba: straightToPremultipliedRgba(decoded.rgba),
      };
    } catch {
      // Fall through to Pillow if a malformed PNG needs lenient decoding.
    }
  }

  return sharedDecoder.decode(bytes);
}
