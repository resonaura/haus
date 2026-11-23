/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Image as HausImage, px, VectorGraphic } from '@haus/ui';
import { Database, HardDrive, Laptop, Monitor, Server as ServerGlyph } from 'lucide-react';
import type { SimpleIcon } from 'simple-icons';
import windowsLogo from '@iconify-icons/logos/microsoft-windows-icon';
import mikuChibi from '../../assets/server-icons/miku-chibi.svg';
import {
  siAlpinelinux,
  siApple,
  siArchlinux,
  siDebian,
  siFedora,
  siHomeassistant,
  siLinux,
  siNixos,
  siOpensuse,
  siRaspberrypi,
  siUbuntu,
} from 'simple-icons';
import { resolveServerIcon, type ServerIconSource } from '../../model/server-icon';

const windowsPaths = Array.from(
  windowsLogo.body.matchAll(/<path\b[^>]*\bd="([^"]+)"/g),
  (match) => match[1],
);

function SimpleBrandIcon({
  icon,
  size,
  className,
}: {
  icon: SimpleIcon;
  size: number;
  className?: string;
}) {
  return (
    <VectorGraphic
      viewWidth={24}
      viewHeight={24}
      className={className}
      style={{ layout: { width: px(size), height: px(size) } }}
      paths={[{ d: icon.path, fill: 'currentColor' }]}
    />
  );
}

function WindowsBrandIcon({ size, className }: { size: number; className?: string }) {
  return (
    <VectorGraphic
      viewWidth={windowsLogo.width ?? 24}
      viewHeight={windowsLogo.height ?? 24}
      className={className}
      style={{ layout: { width: px(size), height: px(size) } }}
      paths={windowsPaths.map((d) => ({ d, fill: 'currentColor' }))}
    />
  );
}

export function ServerIcon({
  server,
  icon,
  size = 22,
  className,
}: {
  server: ServerIconSource;
  icon?: string;
  size?: number;
  className?: string;
}) {
  const resolved = resolveServerIcon(server, icon);
  const symbolClassName = `server-device-symbol ${className ?? ''}`;
  const props = { size, className: symbolClassName, 'aria-hidden': true as const };

  if (resolved === 'miku')
    return (
      <HausImage
        src={mikuChibi}
        className={`${symbolClassName} server-artwork-icon`}
        style={{ layout: { width: px(size), height: px(size) } }}
        alt=""
        ariaHidden
      />
    );
  if (resolved === 'windows') return <WindowsBrandIcon size={size} className={symbolClassName} />;
  if (resolved === 'home-assistant')
    return <SimpleBrandIcon icon={siHomeassistant} size={size} className={symbolClassName} />;
  if (resolved === 'macos')
    return <SimpleBrandIcon icon={siApple} size={size} className={symbolClassName} />;
  if (resolved === 'linux')
    return <SimpleBrandIcon icon={siLinux} size={size} className={symbolClassName} />;
  if (resolved === 'ubuntu')
    return <SimpleBrandIcon icon={siUbuntu} size={size} className={symbolClassName} />;
  if (resolved === 'debian')
    return <SimpleBrandIcon icon={siDebian} size={size} className={symbolClassName} />;
  if (resolved === 'fedora')
    return <SimpleBrandIcon icon={siFedora} size={size} className={symbolClassName} />;
  if (resolved === 'arch')
    return <SimpleBrandIcon icon={siArchlinux} size={size} className={symbolClassName} />;
  if (resolved === 'nixos')
    return <SimpleBrandIcon icon={siNixos} size={size} className={symbolClassName} />;
  if (resolved === 'alpine')
    return <SimpleBrandIcon icon={siAlpinelinux} size={size} className={symbolClassName} />;
  if (resolved === 'raspberry-pi')
    return <SimpleBrandIcon icon={siRaspberrypi} size={size} className={symbolClassName} />;
  if (resolved === 'opensuse')
    return <SimpleBrandIcon icon={siOpensuse} size={size} className={symbolClassName} />;
  if (resolved === 'desktop') return <Monitor {...props} />;
  if (resolved === 'laptop') return <Laptop {...props} />;
  if (resolved === 'nas') return <Database {...props} />;
  if (resolved === 'storage') return <HardDrive {...props} />;
  return <ServerGlyph {...props} />;
}
