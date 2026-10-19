type Thumbnail = {
  image: HTMLImageElement;
  bitmap?: ImageBitmap;
  loadedAt: number;
  failed: boolean;
  decoding: boolean;
};
/** Only visible thumbnails and a small prefetch margin may occupy decoder/network slots. */
export class ThumbnailPool {
  private entries = new Map<string, Thumbnail>();
  private visible = new Set<string>();
  private queue: string[] = [];
  private active = new Set<Thumbnail>();
  private stopped = false;
  constructor(
    private invalidate: () => void,
    private limit = 64,
    private concurrency = 4,
    private create = () => new Image(),
  ) {}
  setVisible(ids: string[]) {
    ids = ids.slice(0, this.limit);
    this.visible = new Set(ids);
    for (const [id, entry] of this.entries)
      if (this.active.has(entry) && !this.visible.has(id)) {
        entry.image.onload = entry.image.onerror = null;
        entry.image.src = '';
        this.entries.delete(id);
        if (!entry.decoding) this.active.delete(entry);
      }
    this.queue = ids.filter((id) => !this.entries.has(id));
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.limit) break;
      if (!this.visible.has(id)) {
        this.entries.get(id)?.bitmap?.close();
        this.entries.delete(id);
      }
    }
    this.pump();
  }
  private pump() {
    while (!this.stopped && this.active.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      if (!this.visible.has(id) || this.entries.has(id)) continue;
      if (this.entries.size >= this.limit)
        for (const [old, entry] of this.entries) {
          if (!this.visible.has(old)) {
            entry.image.onload = entry.image.onerror = null;
            entry.bitmap?.close();
            this.entries.delete(old);
            break;
          }
        }
      const image = this.create();
      const entry: Thumbnail = { image, loadedAt: 0, failed: false, decoding: false };
      this.entries.set(id, entry);
      this.active.add(entry);
      image.decoding = 'async';
      const finish = (failed: boolean) => {
        this.active.delete(entry);
        if (this.stopped || this.entries.get(id) !== entry) {
          this.pump();
          return;
        }
        entry.failed = failed;
        entry.loadedAt = performance.now();
        image.onload = image.onerror = null;
        this.invalidate();
        this.pump();
      };
      image.onload = () => {
        image.onload = image.onerror = null;
        if (typeof createImageBitmap === 'function' && image.naturalWidth > 0) {
          entry.decoding = true;
          const width = image.naturalWidth,
            height = image.naturalHeight,
            ratio = 172 / 74;
          const cropWidth = Math.min(width, height * ratio),
            cropHeight = Math.min(height, width / ratio);
          void createImageBitmap(
            image,
            (width - cropWidth) / 2,
            (height - cropHeight) / 2,
            cropWidth,
            cropHeight,
            { resizeWidth: 172, resizeHeight: 74, resizeQuality: 'high' },
          )
            .then((bitmap) => {
              if (this.stopped || this.entries.get(id) !== entry) {
                bitmap.close();
                finish(false);
                return;
              }
              entry.bitmap = bitmap;
              image.src = '';
              finish(false);
            })
            .catch(() => finish(false));
        } else finish(false);
      };
      image.onerror = () => finish(true);
      image.src = `haus-media://recordings/${id}/thumbnail`;
    }
  }
  get(id: string, now: number) {
    const entry = this.entries.get(id);
    return entry && !entry.failed && entry.loadedAt
      ? {
          image: entry.bitmap ?? entry.image,
          width: entry.bitmap?.width ?? entry.image.naturalWidth,
          height: entry.bitmap?.height ?? entry.image.naturalHeight,
          opacity: Math.min(1, (now - entry.loadedAt) / 180),
        }
      : undefined;
  }
  fading(now: number) {
    return [...this.visible].some((id) => {
      const entry = this.entries.get(id);
      return entry && entry.loadedAt && !entry.failed && now - entry.loadedAt < 180;
    });
  }
  stats() {
    return { cached: this.entries.size, active: this.active.size, queued: this.queue.length };
  }
  dispose() {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      entry.image.onload = entry.image.onerror = null;
      entry.bitmap?.close();
      if (!entry.loadedAt) entry.image.src = '';
    }
    this.entries.clear();
    this.queue = [];
    this.active.clear();
  }
}
