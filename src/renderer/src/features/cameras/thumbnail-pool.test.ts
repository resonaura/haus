import { describe, it, expect, vi } from 'vitest';
import { ThumbnailPool } from './thumbnail-pool';
describe('thumbnail decoder budget', () => {
  it('limits concurrent requests, stops offscreen work and bounds memory', () => {
    const images: HTMLImageElement[] = [];
    const pool = new ThumbnailPool(
      () => {},
      12,
      3,
      () => {
        const image = {
          src: '',
          onload: null,
          onerror: null,
          decoding: '',
        } as unknown as HTMLImageElement;
        images.push(image);
        return image;
      },
    );
    pool.setVisible(Array.from({ length: 10 }, (_, i) => String(i)));
    expect(images.length).toBe(3);
    images[0].onload?.(new Event('load'));
    expect(images.length).toBe(4);
    pool.setVisible(['100', '101']);
    expect(images[1].src).toBe('');
    expect(images.length).toBe(6);
    pool.dispose();
    expect(images[5].src).toBe('');
    pool.setVisible(['200']);
    expect(images.length).toBe(6);
  });
});

it('does not free a slot until a cancelled asynchronous bitmap decode actually completes', async () => {
  const images: HTMLImageElement[] = [],
    resolvers: ((bitmap: ImageBitmap) => void)[] = [];
  let closed = 0;
  vi.stubGlobal(
    'createImageBitmap',
    () => new Promise<ImageBitmap>((resolve) => resolvers.push(resolve)),
  );
  const pool = new ThumbnailPool(
    () => {},
    12,
    2,
    () => {
      const image = {
        src: '',
        onload: null,
        onerror: null,
        naturalWidth: 640,
        naturalHeight: 360,
      } as unknown as HTMLImageElement;
      images.push(image);
      return image;
    },
  );
  try {
    pool.setVisible(['one', 'two']);
    images[0].onload?.(new Event('load'));
    images[1].onload?.(new Event('load'));
    pool.setVisible(['three', 'four']);
    expect(images).toHaveLength(2);
    expect(pool.stats().active).toBe(2);
    resolvers[0]({
      width: 172,
      height: 74,
      close: () => {
        closed++;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(images).toHaveLength(3);
    expect(pool.stats().active).toBe(2);
    expect(closed).toBe(1);
    resolvers[1]({
      width: 172,
      height: 74,
      close: () => {
        closed++;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(images).toHaveLength(4);
    expect(closed).toBe(2);
  } finally {
    pool.dispose();
    vi.unstubAllGlobals();
  }
});
