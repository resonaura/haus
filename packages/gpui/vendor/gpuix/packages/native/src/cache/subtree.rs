//! Subtree and deferred-portal layer cache records and key hashing.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::ops::Range;
use std::rc::Rc;

use gpui::{
    Bounds, ContentMask, EntityId, PaintIndex, Pixels, PrepaintStateIndex, Size, Style, TextStyle,
    Window,
};
use rustc_hash::{FxHashMap, FxHashSet, FxHasher};

pub(crate) use super::element::CachedSubtreeElement;
use crate::renderer::Inherited;
use crate::text::paint::TextPaintCheckpoint;

/// Minimum retained element count for an interior container to maintain a replay boundary.
pub(crate) const MIN_INTERIOR_SUBTREE_ELEMENTS: u32 = 12;

/// Synthetic cache slot ID reserved for the hoisted background window layer.
pub(crate) const BACKGROUND_LAYER_CACHE_ID: u64 = u64::MAX - 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SubtreeCacheKey {
    pub revision: u64,
    pub scroll_hash: u64,
    pub inherited_hash: u64,
    pub focus_hash: u64,
    pub portals_hash: u64,
    pub motion_epoch: u64,
    pub pointer_hash: u64,
}

#[derive(Clone)]
pub(crate) struct SubtreeFallbackSpec {
    pub element_id: u64,
    pub is_background_layer: bool,
    pub hoist_portals: bool,
    pub inherited: Inherited,
}

pub(crate) struct SubtreeRecord {
    pub key: SubtreeCacheKey,
    pub recorded_frame: u64,
    pub painted_frame: Option<u64>,
    pub bounds: Bounds<Pixels>,
    pub raw_origin_bits: (u32, u32),
    pub raw_device_size: Size<f32>,
    pub content_mask: ContentMask<Pixels>,
    pub text_style: TextStyle,
    pub rem_size: Pixels,
    pub scale_bits: u32,
    pub opacity: f32,
    pub outer_style: Style,
    pub accessed_entities: FxHashSet<EntityId>,
    pub prepaint_range: Range<PrepaintStateIndex>,
    pub paint_range: Range<PaintIndex>,
    pub bounds_log_range: Range<usize>,
    pub text_paint_range: (TextPaintCheckpoint, TextPaintCheckpoint),
    pub element_count: u64,
    pub replayable: bool,
}

#[derive(Default)]
pub(crate) struct SubtreeCache {
    pub(crate) records: FxHashMap<u64, SubtreeRecord>,
    pub last_root_layout_revision: Option<u64>,
    pub last_viewport_bits: Option<(u32, u32, u32, u32)>,
    pub replayed_subtrees_this_frame: u64,
    pub replayed_elements_this_frame: u64,
}

impl SubtreeCache {
    pub fn begin_frame(&mut self) {
        self.replayed_subtrees_this_frame = 0;
        self.replayed_elements_this_frame = 0;
    }

    pub fn prune_missing(&mut self, keep: impl Fn(u64) -> bool) {
        self.records
            .retain(|&id, _| id == BACKGROUND_LAYER_CACHE_ID || keep(id));
    }

    pub fn clear(&mut self) {
        self.records.clear();
        self.last_root_layout_revision = None;
        self.last_viewport_bits = None;
    }

    /// Returns `(outer_style, raw_device_size, element_count)` when `cache_id` can replay.
    pub fn can_replay(
        &self,
        cache_id: u64,
        key: &SubtreeCacheKey,
        window: &Window,
    ) -> Option<(Style, Size<f32>, u64)> {
        let record = self.records.get(&cache_id)?;
        if !record.replayable
            || &record.key != key
            || record.painted_frame != Some(record.recorded_frame)
            || !window.can_replay_subtree(record.recorded_frame)
            || record.rem_size != window.rem_size()
            || record.scale_bits != window.scale_factor().to_bits()
            || window.has_any_dirty_view(&record.accessed_entities)
        {
            return None;
        }
        Some((
            record.outer_style.clone(),
            record.raw_device_size,
            record.element_count,
        ))
    }
}

pub(crate) type SharedSubtreeCache = Rc<RefCell<SubtreeCache>>;

pub(crate) fn hash_inherited(inherited: &Inherited) -> u64 {
    let mut hasher = FxHasher::default();
    inherited.selectable.hash(&mut hasher);
    inherited.selection_wash.h.to_bits().hash(&mut hasher);
    inherited.selection_wash.s.to_bits().hash(&mut hasher);
    inherited.selection_wash.l.to_bits().hash(&mut hasher);
    inherited.selection_wash.a.to_bits().hash(&mut hasher);
    match &inherited.highlight {
        Some(ctx) => (std::sync::Arc::as_ptr(ctx) as usize).hash(&mut hasher),
        None => 0usize.hash(&mut hasher),
    }
    hasher.finish()
}

pub(crate) fn hash_focus(keyboard_focus: Option<&[u64]>, dim_enabled: bool) -> u64 {
    let mut hasher = FxHasher::default();
    dim_enabled.hash(&mut hasher);
    if let Some(path) = keyboard_focus {
        path.hash(&mut hasher);
    }
    hasher.finish()
}

pub(crate) fn hash_scroll_handles(
    handles: &std::collections::HashMap<u64, gpui::ScrollHandle>,
    now_ms: f64,
    last_scroll_activity_ms: &mut FxHashMap<u64, (u32, u32, f64)>,
) -> (u64, bool) {
    let mut ids: Vec<u64> = handles.keys().copied().collect();
    ids.sort_unstable();
    let mut hasher = FxHasher::default();
    let mut fade_settling = false;
    for id in ids {
        let Some(handle) = handles.get(&id) else {
            continue;
        };
        let off = handle.offset();
        let b = handle.bounds();
        let ox = f32::from(off.x).to_bits();
        let oy = f32::from(off.y).to_bits();
        let bw = f32::from(b.size.width).to_bits();
        let bh = f32::from(b.size.height).to_bits();
        id.hash(&mut hasher);
        ox.hash(&mut hasher);
        oy.hash(&mut hasher);
        bw.hash(&mut hasher);
        bh.hash(&mut hasher);
        match last_scroll_activity_ms.get_mut(&id) {
            Some(entry) => {
                if entry.0 != ox || entry.1 != oy {
                    *entry = (ox, oy, now_ms);
                    fade_settling = true;
                } else if now_ms - entry.2 < 220.0 {
                    fade_settling = true;
                }
            }
            None => {
                last_scroll_activity_ms.insert(id, (ox, oy, -1000.0));
            }
        }
    }
    (hasher.finish(), fade_settling)
}
