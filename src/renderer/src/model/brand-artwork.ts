export type BrandRaster = { width: number; height: number; data: Uint8ClampedArray };
type Bounds = { x: number; y: number; width: number; height: number };
export type AnalyzedBrandArtwork = {
  data: Uint8ClampedArray;
  bounds: Bounds;
  layout: 'fill' | 'inset';
  template: boolean;
  backgroundRemoved: boolean;
};
export type PreparedBrandArtwork = {
  src: string;
  layout: 'fill' | 'inset';
  template: boolean;
  width: number;
  height: number;
  viewBox: string;
  sourceWidth: number;
  sourceHeight: number;
};

function contentBounds({ width, height, data }: BrandRaster, minimumAlpha = 32): Bounds {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < minimumAlpha) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left
    ? { x: 0, y: 0, width, height }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function distance(data: Uint8ClampedArray, offset: number, color: number[]): number {
  return Math.max(...color.map((channel, i) => Math.abs(channel - data[offset + i])));
}

/** Separate a confidently flat, edge-connected backdrop, never arbitrary logo colors. */
function flatBackground(raster: BrandRaster, bounds: Bounds): number[] | null {
  const { width, data } = raster;
  const rimX = Math.max(1, Math.round(bounds.width * 0.08));
  const rimY = Math.max(1, Math.round(bounds.height * 0.08));
  const samples: number[] = [];
  let rimPixels = 0;
  const bins = new Map<string, { count: number; color: number[] }>();
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if (
        x >= bounds.x + rimX &&
        x < bounds.x + bounds.width - rimX &&
        y >= bounds.y + rimY &&
        y < bounds.y + bounds.height - rimY
      )
        continue;
      rimPixels++;
      const i = (y * width + x) * 4;
      if (data[i + 3] < 240) continue;
      samples.push(i);
      const color = [data[i], data[i + 1], data[i + 2]];
      const key = color.map((value) => Math.round(value / 16)).join(':');
      const bin = bins.get(key);
      if (bin) bin.count++;
      else bins.set(key, { count: 1, color });
    }
  }
  const winner = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner || samples.length / rimPixels < 0.6) return null;
  const matching = samples.filter((i) => distance(data, i, winner.color) < 20);
  if (matching.length / samples.length < 0.92) return null;
  return [0, 1, 2].map((channel) =>
    Math.round(matching.reduce((sum, i) => sum + data[i + channel], 0) / matching.length),
  );
}

function separateBackground(raster: BrandRaster, color: number[]): Uint8ClampedArray | null {
  const { width, height, data } = raster;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let start = 0,
    end = 0,
    removed = 0;
  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const i = pixel * 4;
    if (data[i + 3] > 224 && distance(data, i, color) > 30) return;
    queue[end++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  const result = new Uint8ClampedArray(data);
  while (start < end) {
    const pixel = queue[start++];
    if (data[pixel * 4 + 3] >= 32) removed++;
    result[pixel * 4 + 3] = 0;
    const x = pixel % width,
      y = Math.floor(pixel / width);
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (y > 0) visit(pixel - width);
    if (y < height - 1) visit(pixel + width);
  }
  const original = data.reduce((sum, value, i) => sum + (i % 4 === 3 && value >= 32 ? 1 : 0), 0);
  if (removed < original * 0.16 || original - removed < original * 0.025) return null;
  return result;
}

function hasSquareEdges(raster: BrandRaster, bounds: Bounds): boolean {
  const opaque = [0, 0, 0, 0],
    samples = [0, 0, 0, 0];
  for (let y = 0; y < bounds.height; y++)
    for (let x = 0; x < bounds.width; x++) {
      const nx = (x + 0.5) / bounds.width,
        ny = (y + 0.5) / bounds.height;
      const sides = [
        nx < 0.06 && ny > 0.2 && ny < 0.8,
        nx > 0.94 && ny > 0.2 && ny < 0.8,
        ny < 0.06 && nx > 0.2 && nx < 0.8,
        ny > 0.94 && nx > 0.2 && nx < 0.8,
      ];
      for (let side = 0; side < 4; side++)
        if (sides[side]) {
          samples[side]++;
          if (raster.data[((bounds.y + y) * raster.width + bounds.x + x) * 4 + 3] >= 224)
            opaque[side]++;
        }
    }
  return samples.every((count, side) => count > 0 && opaque[side] / count > 0.9);
}

export function analyzeBrandArtwork(raster: BrandRaster): AnalyzedBrandArtwork {
  // Ignore baked-in drop shadows when recognizing an existing rounded-square tile.
  const originalBounds = contentBounds(raster, 224);
  const background = flatBackground(raster, originalBounds);
  const separated = background ? separateBackground(raster, background) : null;
  const data = separated ?? new Uint8ClampedArray(raster.data);
  const bounds = separated
    ? contentBounds({ width: raster.width, height: raster.height, data })
    : originalBounds;
  let opaque = 0,
    neutralInk = 0,
    chromatic = 0,
    inner = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const i = (y * raster.width + x) * 4;
      inner++;
      if (data[i + 3] < 128) continue;
      opaque++;
      const high = Math.max(data[i], data[i + 1], data[i + 2]);
      const low = Math.min(data[i], data[i + 1], data[i + 2]);
      if (high < 115 && high - low < 40) neutralInk++;
      if (high - low > 40) chromatic++;
    }
  }
  const ratio = bounds.width / bounds.height;
  const filledSquare =
    (!separated || neutralInk / opaque < 0.65) &&
    ratio > 0.88 &&
    ratio < 1.14 &&
    inner > 0 &&
    opaque / inner > 0.55 &&
    hasSquareEdges({ width: raster.width, height: raster.height, data }, bounds);
  const template =
    !filledSquare && opaque > 0 && neutralInk / opaque > 0.65 && chromatic / opaque < 0.02;
  if (template && separated && background && Math.min(...background) > 180) {
    // Recover coverage from a light matte instead of turning antialiased edge pixels
    // into solid white. This keeps small bitmap silhouettes smooth when scaled up.
    const matte = (background[0] + background[1] + background[2]) / 3;
    let ink = 0,
      samples = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128 || Math.max(data[i], data[i + 1], data[i + 2]) > 80) continue;
      ink += (data[i] + data[i + 1] + data[i + 2]) / 3;
      samples++;
    }
    const contrast = matte - (samples ? ink / samples : 0);
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const coverage = Math.max(0, Math.min(1, (matte - luminance) / contrast));
      data[i + 3] *= coverage;
      if (coverage > 0 && coverage < 1)
        for (let channel = 0; channel < 3; channel++)
          data[i + channel] = (data[i + channel] - background[channel] * (1 - coverage)) / coverage;
    }
  }
  return {
    data,
    bounds,
    layout: filledSquare ? 'fill' : 'inset',
    // Neutral silhouettes use a light material in dark mode, with no RGB inversion.
    template,
    backgroundRemoved: separated !== null,
  };
}

export async function prepareBrandArtwork(src: string): Promise<PreparedBrandArtwork> {
  const image = new Image();
  image.src = src;
  await image.decode();
  // Analysis can be small; painting must retain the original vector or bitmap resolution.
  const scale = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context)
    return {
      src,
      layout: 'inset',
      template: false,
      width: 68,
      height: 68,
      viewBox: `0 0 ${image.naturalWidth} ${image.naturalHeight}`,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
    };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const analyzed = analyzeBrandArtwork(pixels);
  const ratio = analyzed.bounds.width / analyzed.bounds.height;
  const extent = ratio > 1.8 || ratio < 0.56 ? 78 : 68;
  const sizing = {
    width: ratio >= 1 ? extent : extent * ratio,
    height: ratio >= 1 ? extent / ratio : extent,
  };
  if (!analyzed.backgroundRemoved)
    return {
      src,
      layout: analyzed.layout,
      template: analyzed.template,
      ...sizing,
      viewBox: [
        analyzed.bounds.x / scale,
        analyzed.bounds.y / scale,
        analyzed.bounds.width / scale,
        analyzed.bounds.height / scale,
      ].join(' '),
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
    };
  // Only separated flat backgrounds need a new bitmap. Work at source resolution,
  // rather than stretching the low-resolution analysis mask into the interface.
  const paintScale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * paintScale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * paintScale));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const fullPixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const fullArtwork = analyzeBrandArtwork(fullPixels);
  fullPixels.data.set(fullArtwork.data);
  context.putImageData(fullPixels, 0, 0);
  const cropped = document.createElement('canvas');
  cropped.width = fullArtwork.bounds.width;
  cropped.height = fullArtwork.bounds.height;
  cropped
    .getContext('2d')!
    .drawImage(
      canvas,
      fullArtwork.bounds.x,
      fullArtwork.bounds.y,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );
  return {
    src: cropped.toDataURL('image/png'),
    layout: analyzed.layout,
    template: analyzed.template,
    ...sizing,
    viewBox: `0 0 ${cropped.width} ${cropped.height}`,
    sourceWidth: cropped.width,
    sourceHeight: cropped.height,
  };
}
