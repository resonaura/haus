use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::rc::Rc;
use std::sync::Arc;

const MAX_IDLE_ENTRIES: usize = 32;
const MAX_IDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_DATA_IDLE_IMAGE_BYTES: usize = 512 * 1024;
const MAX_RESOURCE_IDLE_IMAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ImageSourceKind {
    Data,
    Path,
    Uri,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ImageCacheKey {
    pub kind: ImageSourceKind,
    pub len: usize,
    pub hash1: u64,
    pub hash2: u64,
}

impl ImageCacheKey {
    pub fn new(kind: ImageSourceKind, src: &str) -> Self {
        let mut std_hasher = std::collections::hash_map::DefaultHasher::new();
        src.as_bytes().hash(&mut std_hasher);
        let hash1 = std_hasher.finish();

        // Second independent 64-bit FNV-1a mixer so we never retain huge data URLs as keys.
        let mut hash2: u64 = 0xcbf2_9ce4_8422_2325;
        for &byte in src.as_bytes() {
            hash2 ^= u64::from(byte);
            hash2 = hash2.wrapping_mul(0x0100_0000_01b3);
        }

        Self {
            kind,
            len: src.len(),
            hash1,
            hash2,
        }
    }
}

pub fn render_image_bytes(image: &gpui::RenderImage) -> usize {
    let mut total = 0usize;
    for frame in 0..image.frame_count() {
        if let Some(bytes) = image.as_bytes(frame) {
            total = total.saturating_add(bytes.len());
        }
    }
    total.max(4)
}

struct CachedImageEntry {
    image: Arc<gpui::RenderImage>,
    refs: usize,
    bytes: usize,
    last_used: u64,
    allow_idle: bool,
}

#[derive(Default)]
pub struct DecodedImageCache {
    entries: HashMap<ImageCacheKey, CachedImageEntry>,
    pending_drops: Vec<Arc<gpui::RenderImage>>,
    clock: u64,
    idle_bytes: usize,
    #[cfg(test)]
    max_idle_entries: Option<usize>,
    #[cfg(test)]
    max_idle_bytes: Option<usize>,
}

pub type SharedImgCache = Rc<RefCell<DecodedImageCache>>;

pub fn new_shared_cache() -> SharedImgCache {
    Rc::new(RefCell::new(DecodedImageCache::default()))
}

impl DecodedImageCache {
    fn idle_caps(&self) -> (usize, usize) {
        #[cfg(test)]
        {
            (
                self.max_idle_entries.unwrap_or(MAX_IDLE_ENTRIES),
                self.max_idle_bytes.unwrap_or(MAX_IDLE_BYTES),
            )
        }
        #[cfg(not(test))]
        {
            (MAX_IDLE_ENTRIES, MAX_IDLE_BYTES)
        }
    }

    pub fn acquire(&mut self, key: &ImageCacheKey) -> Option<Arc<gpui::RenderImage>> {
        let entry = self.entries.get_mut(key)?;
        if entry.refs == 0 {
            self.idle_bytes = self.idle_bytes.saturating_sub(entry.bytes);
        }
        entry.refs += 1;
        self.clock = self.clock.wrapping_add(1);
        entry.last_used = self.clock;
        Some(entry.image.clone())
    }

    pub fn insert_or_acquire(
        &mut self,
        key: ImageCacheKey,
        image: Arc<gpui::RenderImage>,
    ) -> Arc<gpui::RenderImage> {
        if let Some(existing) = self.acquire(&key) {
            self.pending_drops.push(image);
            return existing;
        }
        let bytes = render_image_bytes(&image);
        let allow_idle = match key.kind {
            ImageSourceKind::Data => bytes <= MAX_DATA_IDLE_IMAGE_BYTES,
            ImageSourceKind::Path | ImageSourceKind::Uri => bytes <= MAX_RESOURCE_IDLE_IMAGE_BYTES,
        };
        self.clock = self.clock.wrapping_add(1);
        self.entries.insert(
            key,
            CachedImageEntry {
                image: image.clone(),
                refs: 1,
                bytes,
                last_used: self.clock,
                allow_idle,
            },
        );
        image
    }

    pub fn release(&mut self, key: &ImageCacheKey) {
        let should_remove = match self.entries.get_mut(key) {
            Some(entry) if entry.refs > 1 => {
                entry.refs -= 1;
                false
            }
            Some(entry) => {
                entry.refs = 0;
                if !entry.allow_idle {
                    true
                } else {
                    self.clock = self.clock.wrapping_add(1);
                    entry.last_used = self.clock;
                    self.idle_bytes = self.idle_bytes.saturating_add(entry.bytes);
                    false
                }
            }
            None => false,
        };

        if should_remove {
            if let Some(removed) = self.entries.remove(key) {
                self.pending_drops.push(removed.image);
            }
            return;
        }
        self.evict_idle_if_needed();
    }

    fn evict_idle_if_needed(&mut self) {
        let (max_entries, max_bytes) = self.idle_caps();
        loop {
            let idle_count = self.entries.values().filter(|entry| entry.refs == 0).count();
            if idle_count <= max_entries && self.idle_bytes <= max_bytes {
                break;
            }
            let oldest_key = self
                .entries
                .iter()
                .filter(|(_, entry)| entry.refs == 0)
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| *key);
            let Some(key) = oldest_key else {
                break;
            };
            if let Some(removed) = self.entries.remove(&key) {
                self.idle_bytes = self.idle_bytes.saturating_sub(removed.bytes);
                self.pending_drops.push(removed.image);
            }
        }
    }

    pub fn queue_drop(&mut self, image: Arc<gpui::RenderImage>) {
        self.pending_drops.push(image);
    }

    pub fn drain_drops(&mut self, window: &mut gpui::Window) {
        for image in self.pending_drops.drain(..) {
            window.drop_image(image).ok();
        }
    }

    pub fn clear(&mut self) {
        for (_, entry) in self.entries.drain() {
            self.pending_drops.push(entry.image);
        }
        self.idle_bytes = 0;
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn pending_drop_count(&self) -> usize {
        self.pending_drops.len()
    }
}

pub fn decode_data_url_to_render_image(
    src: &str,
    svg_renderer: gpui::SvgRenderer,
) -> std::result::Result<Arc<gpui::RenderImage>, String> {
    let (format, bytes) = super::img::decode_image_data_url(src)
        .ok_or_else(|| "invalid image data URL".to_string())?;
    gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg_renderer)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_render_image(width: u32, height: u32) -> Arc<gpui::RenderImage> {
        let len = (width as usize) * (height as usize) * 4;
        Arc::new(gpui::RenderImage::from_bgra(width, height, vec![255u8; len]).unwrap())
    }

    #[test]
    fn large_data_images_evict_immediately_when_released() {
        let mut cache = DecodedImageCache::default();
        let key = ImageCacheKey::new(ImageSourceKind::Data, "data:image/jpeg;base64,snapshot1");
        let img = test_render_image(512, 512); // 1 MB RGBA > 512 KB threshold
        let id = img.id;

        let acquired = cache.insert_or_acquire(key, img);
        assert_eq!(acquired.id, id);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.pending_drop_count(), 0);

        cache.release(&key);
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.pending_drop_count(), 1);
    }

    #[test]
    fn shared_refs_stay_cached_until_last_consumer_releases() {
        let mut cache = DecodedImageCache::default();
        let key = ImageCacheKey::new(ImageSourceKind::Data, "data:image/jpeg;base64,shared");
        let first = cache.insert_or_acquire(key, test_render_image(512, 512));
        let second = cache.acquire(&key).expect("second ref should hit cache");
        assert_eq!(first.id, second.id);

        cache.release(&key);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.pending_drop_count(), 0);

        cache.release(&key);
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.pending_drop_count(), 1);
    }

    #[test]
    fn small_idle_images_respect_lru_cap() {
        let mut cache = DecodedImageCache {
            max_idle_entries: Some(2),
            ..DecodedImageCache::default()
        };
        for idx in 0..4 {
            let key = ImageCacheKey::new(ImageSourceKind::Path, &format!("/tmp/icon-{idx}.png"));
            cache.insert_or_acquire(key, test_render_image(64, 64));
            cache.release(&key);
        }
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.pending_drop_count(), 2);
    }
}
