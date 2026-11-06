/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TrafficLightArtwork } from '../shared/native';

const run = promisify(execFile);
const UUID = 'yuzuos@resonaura.local';
const roles = ['close', 'minimize', 'zoom'] as const;
const states = ['active', 'inactive', 'hover', 'pressed', 'disabled'] as const;
const service = `const Gio=imports.gi.Gio;
const call=(path,iface,method)=>JSON.parse(Gio.DBus.session.call_sync('org.gnome.Shell',path,iface,method,null,null,Gio.DBusCallFlags.NONE,1500,null).deepUnpack()[0]);
print(JSON.stringify({status:call('/org/gnome/Shell/Extensions/YuzuOS/Runtime','org.gnome.Shell.Extensions.YuzuOS.Runtime','GetStatus'),capabilities:call('/org/gnome/Shell/Extensions/YuzuOS/Development','org.gnome.Shell.Extensions.YuzuOS.Development','GetCapabilities')}));`;

export interface YuzuOSAppearance {
  blur: boolean;
  controls: boolean;
  trafficLights?: TrafficLightArtwork;
}

export interface YuzuOSCapabilities {
  version: number;
  uuid: string;
  revision: string;
  applicationBlur: { enabled: boolean };
  trafficLights: {
    enabled: boolean;
    style: string;
    artworkDirectory: string | null;
    renderScale?: number;
  };
}

export function activeYuzuOSCapabilities(value: unknown): YuzuOSCapabilities | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const status = record.status as Record<string, unknown> | undefined;
  const caps = record.capabilities as YuzuOSCapabilities | undefined;
  if (
    !status ||
    !caps ||
    status.uuid !== UUID ||
    status.enabled !== true ||
    status.phase !== 'active' ||
    status.error != null ||
    caps.version !== 1 ||
    caps.uuid !== UUID ||
    !/^[a-f0-9]{16,64}$/.test(caps.revision) ||
    status.revision !== caps.revision ||
    typeof caps.applicationBlur?.enabled !== 'boolean' ||
    typeof caps.trafficLights?.enabled !== 'boolean' ||
    !['off', 'classic', 'glass', 'alternate'].includes(caps.trafficLights.style)
  )
    return null;
  return caps;
}

/** Read only the validated immutable extension directory; never arbitrary DBus paths. */
export async function loadYuzuOSTrafficLights(
  caps: YuzuOSCapabilities,
  roots = [
    join(
      process.env.XDG_DATA_HOME || join(homedir(), '.local/share'),
      'gnome-shell/extensions',
      UUID,
    ),
    join('/usr/share/gnome-shell/extensions', UUID),
  ],
): Promise<TrafficLightArtwork | undefined> {
  const requested = caps.trafficLights.artworkDirectory;
  if (!caps.trafficLights.enabled || caps.trafficLights.style !== 'glass' || !requested) return;
  const factor = caps.trafficLights.renderScale ?? 1;
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 2)
    throw Error('Invalid YuzuOS display scale');
  const directory = await realpath(requested);
  let allowed = false;
  for (const root of roots) {
    const expected = join(root, 'runtime', caps.revision, 'icons/titlebuttons-native');
    try {
      if ((await realpath(expected)) === directory) allowed = true;
    } catch {
      /* Not installed here. */
    }
  }
  if (!allowed) throw Error('YuzuOS artwork is outside its immutable runtime');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(directory, 'PROVENANCE.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.captureSHA256) ||
    provenance.localNativeAssets !== true ||
    provenance.manifestSHA256 !== manifest.captureSHA256
  )
    throw Error('YuzuOS native artwork provenance is invalid');
  const images = {} as TrafficLightArtwork['images'];
  for (const mode of ['light', 'dark'] as const) {
    images[mode] = {} as TrafficLightArtwork['images']['dark'];
    for (const role of roles) {
      images[mode][role] = {} as TrafficLightArtwork['images']['dark']['close'];
      const frame = manifest.geometry?.[role];
      if (
        !frame ||
        ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
        frame.width < 8 ||
        frame.width > 32 ||
        frame.height < 8 ||
        frame.height > 32
      )
        throw Error('YuzuOS native button geometry is invalid');
      for (const state of states) {
        const urls: string[] = [];
        for (const scale of [1, 2]) {
          const asset = manifest.assets?.[`${mode}-${role}-${state}@${scale}x`];
          if (
            !asset ||
            !/^[a-zA-Z0-9@._-]+\.png$/.test(asset.file) ||
            asset.file.includes('..') ||
            asset.role !== role ||
            asset.state !== state ||
            asset.appearance !== mode ||
            asset.scale !== scale
          )
            throw Error('YuzuOS native button state is invalid');
          const filename = join(directory, asset.file);
          if ((await realpath(filename)) !== filename || (await stat(filename)).size > 256 * 1024)
            throw Error('YuzuOS native PNG escaped its runtime or exceeds limits');
          const data = await readFile(filename);
          if (
            data.length < 24 ||
            data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
            data.readUInt32BE(16) !== Math.ceil(frame.width * scale) ||
            data.readUInt32BE(20) !== Math.ceil(frame.height * scale) ||
            createHash('sha256').update(data).digest('hex') !== asset.sha256
          )
            throw Error('YuzuOS native PNG differs from its capture');
          urls.push(`url("data:image/png;base64,${data.toString('base64')}") ${scale / factor}x`);
        }
        images[mode][role][state] = `image-set(${urls.join(',')})`;
      }
    }
  }
  const close = manifest.geometry.close,
    next = manifest.geometry.minimize;
  const gap = next.x - close.x - close.width;
  if (!Number.isFinite(gap) || gap < 0 || gap > 32) throw Error('Invalid YuzuOS button spacing');
  return {
    identity: caps.revision + ':' + manifest.captureSHA256 + ':' + factor,
    width: close.width * factor,
    height: close.height * factor,
    gap: gap * factor,
    images,
  };
}

let pending: Promise<YuzuOSAppearance> | undefined;
let checkedAt = 0;
let cachedArtwork: TrafficLightArtwork | undefined;
let cachedIdentity: string | undefined;

export async function readYuzuOSAppearance(): Promise<YuzuOSAppearance> {
  if (process.platform !== 'linux') return { blur: false, controls: false };
  if (pending && Date.now() - checkedAt < 800) return pending;
  checkedAt = Date.now();
  pending = (async () => {
    try {
      const { stdout } = await run('gjs', ['-c', service], {
        timeout: 4000,
        maxBuffer: 256 * 1024,
      });
      const caps = activeYuzuOSCapabilities(JSON.parse(stdout));
      if (!caps) return { blur: false, controls: false };
      const identity =
        caps.revision +
        ':' +
        caps.trafficLights.enabled +
        ':' +
        caps.trafficLights.style +
        ':' +
        caps.trafficLights.artworkDirectory +
        ':' +
        caps.trafficLights.renderScale;
      if (cachedIdentity !== identity) {
        cachedArtwork = await loadYuzuOSTrafficLights(caps).catch(() => undefined);
        cachedIdentity = identity;
      }
      return {
        blur: caps.applicationBlur.enabled,
        controls: caps.trafficLights.enabled && caps.trafficLights.style !== 'off',
        trafficLights: caps.trafficLights.enabled ? cachedArtwork : undefined,
      };
    } catch {
      return { blur: false, controls: false };
    }
  })();
  return pending;
}
