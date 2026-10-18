import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeBrandArtwork, prepareBrandArtwork, type BrandRaster } from './brand-artwork';

afterEach(() => vi.unstubAllGlobals());

function raster(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
): BrandRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

describe('brand artwork composition', () => {
  it('keeps source artwork resolution when background separation is unnecessary', async () => {
    const pixels = raster(384, 384, (x, y) => [Math.round(x / 2), Math.round(y / 2), 130, 255]);
    const encode = vi.fn();
    const context = { drawImage: vi.fn(), getImageData: () => pixels };
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1024;
        naturalHeight = 1024;
        src = '';
        decode() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => context, toDataURL: encode }),
    });
    const source = 'data:image/svg+xml,%3Csvg%20viewBox=%220%200%201024%201024%22/%3E';
    const result = await prepareBrandArtwork(source);
    expect(result.src).toBe(source);
    expect(result.sourceWidth).toBe(1024);
    expect(result.sourceHeight).toBe(1024);
    expect(result.viewBox).toBe('0 0 1024 1024');
    expect(encode).not.toHaveBeenCalled();
  });
  it('supports ImageData-style dimensions exposed as prototype getters', () => {
    const source = raster(40, 40, (x, y) =>
      x > 10 && x < 30 && y > 10 && y < 30 ? [20, 170, 240, 255] : [255, 255, 255, 255],
    );
    const imageData = Object.assign(
      Object.create({
        get width() {
          return 40;
        },
        get height() {
          return 40;
        },
      }),
      { data: source.data },
    ) as BrandRaster;
    expect(analyzeBrandArtwork(imageData).bounds).toEqual({ x: 11, y: 11, width: 19, height: 19 });
  });
  it('separates a flat background without changing foreground RGB', () => {
    const source = raster(40, 40, (x, y) =>
      x >= 10 && x < 30 && y >= 10 && y < 30 ? [15, 170, 240, 255] : [255, 255, 255, 255],
    );
    const result = analyzeBrandArtwork(source);
    expect(result.backgroundRemoved).toBe(true);
    expect(result.layout).toBe('fill');
    expect(result.template).toBe(false);
    expect(result.bounds).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(Array.from(result.data.slice((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4))).toEqual([
      15, 170, 240, 255,
    ]);
    expect(result.data[3]).toBe(0);
    expect(source.data[3]).toBe(255);
  });

  it('keeps complex square artwork full bleed instead of making a nested tile', () => {
    const source = raster(40, 40, (x, y) => [x * 6, y * 6, 120, 255]);
    const result = analyzeBrandArtwork(source);
    expect(result.backgroundRemoved).toBe(false);
    expect(result.layout).toBe('fill');
    expect(result.data).toEqual(source.data);
  });

  it('ignores a baked-in shadow around an existing square tile', () => {
    const source = raster(48, 48, (x, y) => {
      if (x >= 4 && x < 44 && y >= 4 && y < 44) return [x * 4, y * 4, 110, 255];
      return [0, 0, 0, 60];
    });
    const result = analyzeBrandArtwork(source);
    expect(result.layout).toBe('fill');
    expect(result.bounds).toEqual({ x: 4, y: 4, width: 40, height: 40 });
  });

  it('fills an existing tile even when its foreground is a transparent cutout', () => {
    const result = analyzeBrandArtwork(
      raster(40, 40, (x, y) =>
        x > 12 && x < 28 && y > 12 && y < 28 ? [0, 0, 0, 0] : [255, 255, 255, 255],
      ),
    );
    expect(result.layout).toBe('fill');
    expect(result.data[(20 * 40 + 20) * 4 + 3]).toBe(0);
  });

  it('preserves transparent multicolor marks and crops only empty margins', () => {
    const source = raster(60, 40, (x, y) =>
      y >= 15 && y < 25 && x >= 5 && x < 55
        ? x < 30
          ? [240, 30, 20, 255]
          : [10, 170, 240, 255]
        : [0, 0, 0, 0],
    );
    const result = analyzeBrandArtwork(source);
    expect(result.layout).toBe('inset');
    expect(result.backgroundRemoved).toBe(false);
    expect(result.template).toBe(false);
    expect(result.bounds).toEqual({ x: 5, y: 15, width: 50, height: 10 });
    expect(result.data).toEqual(source.data);
  });

  it('uses alpha as a template for neutral ink, never an inverse bitmap', () => {
    const result = analyzeBrandArtwork(
      raster(40, 40, (x, y) =>
        x >= 14 && x < 26 && y >= 8 && y < 32 ? [20, 25, 30, 255] : [250, 250, 250, 255],
      ),
    );
    expect(result.backgroundRemoved).toBe(true);
    expect(result.template).toBe(true);
    expect(result.data[(20 * 40 + 20) * 4]).toBe(20);
    expect(result.data[3]).toBe(0);
  });

  it('recovers soft silhouette edges from a light matte', () => {
    const result = analyzeBrandArtwork(
      raster(40, 40, (x, y) => {
        if (x >= 12 && x < 28 && y >= 12 && y < 28)
          return x === 12 || x === 27 || y === 12 || y === 27
            ? [128, 128, 128, 255]
            : [20, 20, 20, 255];
        return [250, 250, 250, 255];
      }),
    );
    expect(result.template).toBe(true);
    expect(result.data[(20 * 40 + 12) * 4 + 3]).toBeGreaterThan(100);
    expect(result.data[(20 * 40 + 12) * 4 + 3]).toBeLessThan(180);
    expect(result.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });

  it('keeps white details enclosed by foreground and rejects removing a whole icon', () => {
    const source = raster(40, 40, (x, y) => {
      if (x >= 8 && x < 32 && y >= 8 && y < 32)
        return x >= 17 && x < 23 && y >= 17 && y < 23 ? [255, 255, 255, 255] : [30, 150, 220, 255];
      return [255, 255, 255, 255];
    });
    const result = analyzeBrandArtwork(source);
    expect(result.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
    const solid = analyzeBrandArtwork(raster(40, 40, () => [20, 150, 220, 255]));
    expect(solid.backgroundRemoved).toBe(false);
    expect(solid.layout).toBe('fill');
  });
});
