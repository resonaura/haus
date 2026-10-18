import { Bonjour, type Service } from 'bonjour-service';
import type { DiscoveredServer } from '../shared/native';
import { normalizeServerUrl } from './validation';

let activeDiscovery: Promise<DiscoveredServer[]> | undefined;

/** Bounded discovery: sockets are released even when multicast is unavailable. */
export function discoverServers(duration = 3500): Promise<DiscoveredServer[]> {
  if (activeDiscovery) return activeDiscovery;
  activeDiscovery = new Promise<DiscoveredServer[]>((resolve) => {
    const servers = new Map<string, DiscoveredServer>();
    let bonjour: Bonjour;
    let timer: NodeJS.Timeout;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      bonjour?.destroy();
      resolve([...servers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    try {
      bonjour = new Bonjour({}, finish);
      bonjour.find({ type: 'home-assistant', protocol: 'tcp' }, (service: Service) => {
        const text = service.txt ?? {};
        if (String(text.landingpage).toLowerCase() === 'true') return;
        const host = service.host.replace(/\.$/, '');
        const advertised = String(text.internal_url ?? text.base_url ?? '');
        try {
          const url = normalizeServerUrl(advertised || `http://${host}:${service.port}`);
          const id = String(text.uuid ?? url);
          servers.set(id, {
            id,
            name: String(text.location_name ?? service.name ?? 'Home Assistant'),
            url,
            host,
            port: service.port,
            ...(text.version && String(text.version) !== '0000.0.0'
              ? { version: String(text.version) }
              : {}),
          });
        } catch {
          // Ignore malformed/untrusted multicast records; manual connection remains available.
        }
      });
      timer = setTimeout(finish, duration);
    } catch {
      finish();
    }
  }).finally(() => {
    activeDiscovery = undefined;
  });
  return activeDiscovery;
}
