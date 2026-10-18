import { useEffect, useState, type CSSProperties } from 'react';
import { Box, Cable } from 'lucide-react';
import { prepareBrandArtwork, type PreparedBrandArtwork } from '../../model/brand-artwork';
import { protocolArtwork } from '../../model/brand-vectors';
import { BrandArtwork } from './BrandArtwork';

const artworkCache = new Map<string, Promise<PreparedBrandArtwork>>();

function artworkFor(src: string): Promise<PreparedBrandArtwork> {
  let result = artworkCache.get(src);
  if (!result) {
    result = prepareBrandArtwork(src).catch(() => ({
      src,
      layout: 'inset',
      template: false,
      width: 68,
      height: 68,
      viewBox: '0 0 100 100',
      sourceWidth: 100,
      sourceHeight: 100,
    }));
    artworkCache.set(src, result);
    if (artworkCache.size > 256) artworkCache.delete(artworkCache.keys().next().value!);
  }
  return result;
}

export function BrandIcon({ kind, id }: { kind: 'integration' | 'addon'; id: string }) {
  const [artwork, setArtwork] = useState<PreparedBrandArtwork | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    setArtwork(null);
    const vector = protocolArtwork(kind, id);
    const source = vector
      ? Promise.resolve(vector)
      : window.hausNative?.brandIcon?.(kind, id, dark);
    void source
      ?.then(async (value) => {
        if (!value) return;
        const prepared = await artworkFor(value);
        if (current) setArtwork(prepared);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [kind, id, dark]);
  return (
    <span
      className={`brand-icon-surface ${artwork?.layout === 'fill' ? 'is-full-bleed' : 'is-inset'}`}
      aria-hidden="true"
    >
      {artwork ? (
        <span
          className={`brand-icon-content ${artwork.template ? 'is-template' : ''}`}
          style={
            {
              '--brand-width': `${artwork.width}%`,
              '--brand-height': `${artwork.height}%`,
            } as CSSProperties
          }
        >
          <BrandArtwork artwork={artwork} />
        </span>
      ) : kind === 'addon' ? (
        <Box size={23} />
      ) : (
        <Cable size={23} />
      )}
    </span>
  );
}
