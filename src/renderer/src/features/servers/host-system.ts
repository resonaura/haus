import type { ServerHost } from './types';

export function hostOperatingSystem(host: ServerHost | null) {
  const os = host?.operatingSystem;
  if (os?.name) return [os.name, os.version, os.architecture].filter(Boolean).join(' · ');
  if (/^(?:Microsoft )?Windows\b/i.test(host?.osName ?? '')) return host!.osName!;
  if (host?.metricsScope === 'wsl' || /microsoft|wsl/i.test(host?.release ?? ''))
    return 'Windows · version not reported';
  return (
    host?.osName ||
    [
      host?.platform === 'darwin'
        ? 'macOS'
        : host?.platform === 'win32'
          ? 'Windows'
          : host?.platform,
      host?.release,
      host?.arch,
    ]
      .filter(Boolean)
      .join(' · ') ||
    'Not reported'
  );
}
export function hostMetricsScope(host: ServerHost | null) {
  if (!host) return 'Not reported';
  if (host.metricsScope === 'wsl' || /microsoft|wsl/i.test(host.release ?? ''))
    return 'WSL resources';
  return host.scope === 'container' ? 'Container' : 'Host system';
}

export function hostBatteryStatus(battery: ServerHost['battery']) {
  if (battery?.charging === true) return 'Charging';
  if (battery?.powerConnected === true) return 'Plugged in';
  if (battery?.powerConnected === false) return 'On battery';
  return battery?.charging === false ? 'Not charging' : '';
}
