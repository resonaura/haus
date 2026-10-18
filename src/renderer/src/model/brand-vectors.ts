import matter from '../assets/brands/matter.svg?raw';
import thread from '../assets/brands/thread.svg?raw';

/** Prefer source geometry to enlarging the server's small protocol thumbnails. */
export function protocolArtwork(kind: 'integration' | 'addon', id: string): string | null {
  const svg =
    kind === 'integration' && id === 'thread'
      ? thread
      : (kind === 'integration' && id === 'matter') ||
          (kind === 'addon' && id === 'core_matter_server')
        ? matter
        : null;
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}
