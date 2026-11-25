//! Per-frame painted geometry recording for native viewport virtualization.

use std::cell::RefCell;
use std::rc::Rc;

use gpui::{px, Bounds, Pixels, Point, ScrollHandle, Size};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ViewportEpoch {
    pub window_w_bits: u32,
    pub window_h_bits: u32,
    pub scale_bits: u32,
    pub rem_bits: u32,
    pub scroll_w_bits: u32,
    pub scroll_h_bits: u32,
    pub scroll_own_rev: u64,
    pub geometry_gen: u64,
}

pub(crate) struct PaintedRecord {
    pub element_id: u64,
    pub parent_id: Option<u64>,
    pub scroll_root_id: u64,
    pub epoch: ViewportEpoch,
    pub subtree_revision: u64,
    pub parent_own_revision: u64,
    pub ancestor_own_hash: u64,
    pub content_origin: Point<Pixels>,
    pub size: Size<Pixels>,
    pub visual_bounds: Bounds<Pixels>,
    pub clips_children: bool,
}

#[derive(Default)]
pub(crate) struct ViewportPaintCollector {
    pub(crate) entries: Vec<PaintedRecord>,
}

impl ViewportPaintCollector {
    pub(crate) fn clear(&mut self) {
        self.entries.clear();
    }

    pub(crate) fn push(&mut self, record: PaintedRecord) {
        self.entries.push(record);
    }
}

/// Captured per-element metadata attached to `track_host_bounds` for elements
/// built inside a scroll container, avoiding any extra GPUI wrapper element.
#[derive(Clone)]
pub(crate) struct ViewportRecordTarget {
    pub collector: Rc<RefCell<ViewportPaintCollector>>,
    pub scroll_handles: Rc<[ScrollHandle]>,
    pub element_id: u64,
    pub parent_id: Option<u64>,
    pub scroll_root_id: u64,
    pub epoch: ViewportEpoch,
    pub subtree_revision: u64,
    pub parent_own_revision: u64,
    pub ancestor_own_hash: u64,
    pub visual_margin: Pixels,
    pub clips_children: bool,
}

impl ViewportRecordTarget {
    pub(crate) fn record(&self, painted_bounds: Bounds<Pixels>) {
        let mut offset = Point::default();
        for handle in self.scroll_handles.iter() {
            offset += handle.offset();
        }
        let content_origin = painted_bounds.origin - offset;
        let content_box = Bounds {
            origin: content_origin,
            size: painted_bounds.size,
        };
        let visual_bounds = if self.visual_margin > px(0.0) {
            content_box.dilate(self.visual_margin)
        } else {
            content_box
        };
        self.collector.borrow_mut().push(PaintedRecord {
            element_id: self.element_id,
            parent_id: self.parent_id,
            scroll_root_id: self.scroll_root_id,
            epoch: self.epoch,
            subtree_revision: self.subtree_revision,
            parent_own_revision: self.parent_own_revision,
            ancestor_own_hash: self.ancestor_own_hash,
            content_origin,
            size: painted_bounds.size,
            visual_bounds,
            clips_children: self.clips_children,
        });
    }
}

pub(crate) fn collect_focusables_preorder(
    id: u64,
    tree: &crate::retained_tree::RetainedTree,
    out: &mut Vec<u64>,
) {
    if tree.focusable_ids.contains(&id) {
        out.push(id);
    }
    if let Some(el) = tree.elements.get(&id) {
        for &child_id in &el.children {
            collect_focusables_preorder(child_id, tree, out);
        }
    }
}

pub(crate) fn mix_ancestor_hash(parent_hash: u64, own_revision: u64) -> u64 {
    parent_hash
        .wrapping_mul(0x517C_C1B7_2722_0A95)
        .wrapping_add(own_revision ^ 0x9E37_79B9_7F4A_7C15)
}
