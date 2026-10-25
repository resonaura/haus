import { describe, expect, it } from 'vitest';
import {
  isServerIconId,
  resolveServerIcon,
  sanitizeServerIcon,
  serverIconOptions,
} from './server-icon';

describe('server icon identity', () => {
  it('identifies Home Assistant independently of its Linux host', () => {
    expect(resolveServerIcon({ kind: 'home-assistant', host: { platform: 'linux' } })).toBe(
      'home-assistant',
    );
    expect(resolveServerIcon({ kind: 'home-assistant', host: null })).toBe('home-assistant');
  });

  it('automatically uses the Miku chibi for the Miku server while allowing overrides', () => {
    expect(
      resolveServerIcon({ id: 'miku', host: { platform: 'linux', distribution: 'Ubuntu' } }),
    ).toBe('miku');
    expect(resolveServerIcon({ name: ' Miku ', host: { platform: 'linux' } })).toBe('miku');
    expect(resolveServerIcon({ id: 'miku', host: { platform: 'linux' } }, 'ubuntu')).toBe('ubuntu');
  });

  it('uses the physical Windows identity for WSL telemetry', () => {
    expect(resolveServerIcon({ host: { platform: 'win32' } })).toBe('windows');
    expect(
      resolveServerIcon({
        host: {
          platform: 'linux',
          release: '6.18.54.1-microsoft-standard-WSL2',
          distribution: 'Ubuntu',
        },
      }),
    ).toBe('windows');
  });

  it('derives the operating-system logo from the detected host OS metadata', () => {
    expect(
      resolveServerIcon({
        host: {
          platform: 'linux',
          operatingSystem: { name: 'Microsoft Windows 10 Pro', platform: 'windows' },
        },
      }),
    ).toBe('windows');
    expect(
      resolveServerIcon({
        host: { platform: 'linux', operatingSystem: { name: 'Home Assistant OS 18.3' } },
      }),
    ).toBe('home-assistant');
    expect(
      resolveServerIcon({
        host: { platform: 'linux', operatingSystem: { name: 'Ubuntu 24.04.4 LTS' } },
      }),
    ).toBe('ubuntu');
  });

  it('recognizes a Mac without relying on the server display name', () => {
    expect(resolveServerIcon({ host: { platform: 'darwin', release: '25.0.0' } })).toBe('macos');
    expect(resolveServerIcon({ host: { osName: 'macOS Tahoe' } })).toBe('macos');
  });

  it.each([
    ['Ubuntu 26.04', 'ubuntu'],
    ['Debian GNU/Linux 13', 'debian'],
    ['Fedora Linux 43', 'fedora'],
    ['Arch Linux', 'arch'],
    ['archlinux', 'arch'],
    ['NixOS 26.05', 'nixos'],
    ['Alpine Linux v3.24', 'alpine'],
    ['Raspberry Pi OS (Debian)', 'raspberry-pi'],
    ['Raspbian', 'raspberry-pi'],
    ['openSUSE Tumbleweed', 'opensuse'],
  ])('selects a distro only when explicitly reported: %s', (distribution, icon) => {
    expect(resolveServerIcon({ host: { platform: 'linux', distribution } })).toBe(icon);
  });

  it('can recognize distribution data already included in release telemetry', () => {
    expect(resolveServerIcon({ host: { platform: 'linux', release: '6.8.0-archlinux' } })).toBe(
      'arch',
    );
    expect(resolveServerIcon({ host: { platform: 'linux', release: '6.18.5-generic' } })).toBe(
      'linux',
    );
  });

  it('does not invent a distribution or OS when metadata is absent', () => {
    expect(resolveServerIcon({})).toBe('server');
    expect(resolveServerIcon({ host: null })).toBe('server');
    expect(resolveServerIcon({ host: { platform: 'freebsd', release: '15.0' } })).toBe('server');
  });

  it('keeps known identity when an offline server still has host metadata', () => {
    const offline = { online: false, host: { platform: 'linux', distribution: 'Debian' } };
    expect(resolveServerIcon(offline)).toBe('debian');
  });

  it('lets users override automatic identity and reset it by removing the choice', () => {
    const server = { kind: 'home-assistant', host: { platform: 'linux' } };
    expect(resolveServerIcon(server, 'nas')).toBe('nas');
    expect(resolveServerIcon(server, undefined)).toBe('home-assistant');
    expect(resolveServerIcon(server, 'auto')).toBe('home-assistant');
  });

  it('only accepts bundled identifiers as saved choices', () => {
    for (const option of serverIconOptions) {
      expect(isServerIconId(option.id)).toBe(true);
      expect(sanitizeServerIcon(option.id)).toBe(option.id);
    }
    for (const value of [
      'auto',
      'https://example.com/icon.svg',
      '<svg/>',
      '__proto__',
      '',
      null,
      4,
    ]) {
      expect(isServerIconId(value)).toBe(false);
      expect(sanitizeServerIcon(value)).toBeUndefined();
    }
    expect(resolveServerIcon({ host: { platform: 'linux' } }, '<script/>')).toBe('linux');
    expect(new Set(serverIconOptions.map(({ id }) => id)).size).toBe(serverIconOptions.length);
  });
});
