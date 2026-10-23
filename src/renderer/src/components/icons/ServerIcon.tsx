import { Database, HardDrive, Laptop, Monitor, Server as ServerGlyph } from 'lucide-react';
import type { SimpleIcon } from 'simple-icons';
import windowsLogo from '@iconify-icons/logos/microsoft-windows-icon';
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      focusable="false"
      aria-hidden="true"
    >
      <path d={icon.path} />
    </svg>
  );
}

function WindowsBrandIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${windowsLogo.width} ${windowsLogo.height}`}
      fill="currentColor"
      className={className}
      focusable="false"
      aria-hidden="true"
    >
      {windowsPaths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
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
  const props = { size, className, 'aria-hidden': true as const };

  if (resolved === 'windows') return <WindowsBrandIcon size={size} className={className} />;
  if (resolved === 'home-assistant')
    return <SimpleBrandIcon icon={siHomeassistant} size={size} className={className} />;
  if (resolved === 'macos')
    return <SimpleBrandIcon icon={siApple} size={size} className={className} />;
  if (resolved === 'linux')
    return <SimpleBrandIcon icon={siLinux} size={size} className={className} />;
  if (resolved === 'ubuntu')
    return <SimpleBrandIcon icon={siUbuntu} size={size} className={className} />;
  if (resolved === 'debian')
    return <SimpleBrandIcon icon={siDebian} size={size} className={className} />;
  if (resolved === 'fedora')
    return <SimpleBrandIcon icon={siFedora} size={size} className={className} />;
  if (resolved === 'arch')
    return <SimpleBrandIcon icon={siArchlinux} size={size} className={className} />;
  if (resolved === 'nixos')
    return <SimpleBrandIcon icon={siNixos} size={size} className={className} />;
  if (resolved === 'alpine')
    return <SimpleBrandIcon icon={siAlpinelinux} size={size} className={className} />;
  if (resolved === 'raspberry-pi')
    return <SimpleBrandIcon icon={siRaspberrypi} size={size} className={className} />;
  if (resolved === 'opensuse')
    return <SimpleBrandIcon icon={siOpensuse} size={size} className={className} />;
  if (resolved === 'desktop') return <Monitor {...props} />;
  if (resolved === 'laptop') return <Laptop {...props} />;
  if (resolved === 'nas') return <Database {...props} />;
  if (resolved === 'storage') return <HardDrive {...props} />;
  return <ServerGlyph {...props} />;
}
