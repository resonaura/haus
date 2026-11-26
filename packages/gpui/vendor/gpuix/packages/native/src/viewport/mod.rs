//! Automatic engine-level viewport virtualization for ordinary scroll containers.
//!
//! Works without page markup changes or special tags: once a scroll container
//! and its descendants complete an initial layout pass, offscreen subtrees
//! outside the viewport + overscan band collapse into geometry-preserving
//! proxies (`spacer.rs`) and contiguous flex/grid runs (`plan.rs`).

pub(crate) mod plan;
pub(crate) mod record;
pub(crate) mod spacer;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui::{
    px, Bounds, ElementId, FocusHandle, IntoElement, Point, ScrollHandle, Size, Style, Window,
};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::retained_tree::{RetainedElement, RetainedTree};

pub(crate) use self::record::{
    mix_ancestor_hash, ViewportEpoch, ViewportPaintCollector, ViewportRecordTarget,
};
use self::record::collect_focusables_preorder;
use self::spacer::{placeholder_style, ViewportSpacerElement};

/// Overscan margin (logical pixels) around each active scroll viewport.
/// Keeps drop shadows, glass-rim glows, backdrop blurs, and fast trackpad
/// flings fully warm and pixel-identical at viewport edges.
pub(crate) const OVERSCAN_PX: f32 = 256.0;

#[derive(Clone, Debug)]
pub(crate) struct CachedBox {
    pub scroll_root_id: u64,
    pub epoch: ViewportEpoch,
    pub subtree_revision: u64,
    pub parent_own_revision: u64,
    pub ancestor_own_hash: u64,
    /// Border-box origin in cumulative-scroll-invariant coordinates
    /// (`painted_origin - cumulative_scroll_offset`).
    pub content_origin: Point<gpui::Pixels>,
    /// Exact painted border-box size.
    pub size: Size<gpui::Pixels>,
    /// Visual bounds (own shadow/outline/transform reach unioned with clipped
    /// descendant visual bounds) in scroll-invariant coordinates.
    pub visual_bounds: Bounds<gpui::Pixels>,
    /// True if this element or any descendant owned a focus handle at capture.
    pub contains_focusable: bool,
}

#[derive(Clone)]
pub(crate) struct ActiveScrollClip {
    pub scroll_root_id: u64,
    pub clip_rect: Bounds<gpui::Pixels>,
    pub scroll_offset: Point<gpui::Pixels>,
    pub scroll_handles: Rc<[ScrollHandle]>,
    pub epoch: ViewportEpoch,
    pub culling_enabled: bool,
}

pub(crate) struct ViewportCache {
    boxes: FxHashMap<u64, CachedBox>,
    geometry_gen: FxHashMap<u64, u64>,
    culled_roots_last_frame: FxHashSet<u64>,
    culled_roots_this_frame: FxHashSet<u64>,
    invalidated_roots: Rc<RefCell<FxHashSet<u64>>>,
    collector: Rc<RefCell<ViewportPaintCollector>>,
    focusable_cache: FxHashMap<u64, (u64, Vec<u64>)>,
    last_tree_len: usize,
}

impl Default for ViewportCache {
    fn default() -> Self {
        Self {
            boxes: FxHashMap::default(),
            geometry_gen: FxHashMap::default(),
            culled_roots_last_frame: FxHashSet::default(),
            culled_roots_this_frame: FxHashSet::default(),
            invalidated_roots: Rc::new(RefCell::new(FxHashSet::default())),
            collector: Rc::new(RefCell::new(ViewportPaintCollector::default())),
            focusable_cache: FxHashMap::default(),
            last_tree_len: 0,
        }
    }
}

impl ViewportCache {
    pub(crate) fn collector(&self) -> Rc<RefCell<ViewportPaintCollector>> {
        self.collector.clone()
    }

    pub(crate) fn begin_frame(&mut self, tree: &RetainedTree) {
        std::mem::swap(
            &mut self.culled_roots_last_frame,
            &mut self.culled_roots_this_frame,
        );
        self.culled_roots_this_frame.clear();
        self.commit_painted(tree);
        self.collector.borrow_mut().clear();

        let tree_len = tree.elements.len();
        if tree_len < self.last_tree_len || self.boxes.len() > tree_len.saturating_mul(2).max(512) {
            self.boxes.retain(|id, _| tree.elements.contains_key(id));
            self.geometry_gen
                .retain(|id, _| tree.elements.contains_key(id));
            self.focusable_cache
                .retain(|id, _| tree.elements.contains_key(id));
        }
        self.last_tree_len = tree_len;
    }

    fn commit_painted(&mut self, tree: &RetainedTree) {
        {
            let mut invalidated = self.invalidated_roots.borrow_mut();
            for scroll_root_id in invalidated.drain() {
                let gen = self.geometry_gen.entry(scroll_root_id).or_insert(0);
                *gen = gen.wrapping_add(1);
            }
        }

        let mut entries = {
            let mut collector = self.collector.borrow_mut();
            std::mem::take(&mut collector.entries)
        };
        if entries.is_empty() {
            return;
        }

        // `on_painted` runs in pre-order; walking in reverse visits every
        // painted child before its parent for O(N_painted) bounds folding.
        let mut index_by_id: FxHashMap<u64, usize> =
            FxHashMap::with_capacity_and_hasher(entries.len(), Default::default());
        for (idx, entry) in entries.iter().enumerate() {
            index_by_id.insert(entry.element_id, idx);
        }

        let mut contains_focusable = vec![false; entries.len()];
        for (idx, entry) in entries.iter().enumerate() {
            if tree.focusable_ids.contains(&entry.element_id) {
                contains_focusable[idx] = true;
            }
        }

        let mut size_changed_roots: FxHashSet<u64> = FxHashSet::default();
        for idx in (0..entries.len()).rev() {
            let child_visual = entries[idx].visual_bounds;
            let child_focusable = contains_focusable[idx];
            let child_scroll_root = entries[idx].scroll_root_id;
            if let Some(parent_id) = entries[idx].parent_id {
                if let Some(&parent_idx) = index_by_id.get(&parent_id) {
                    if entries[parent_idx].scroll_root_id == child_scroll_root {
                        if !entries[parent_idx].clips_children {
                            entries[parent_idx].visual_bounds =
                                entries[parent_idx].visual_bounds.union(&child_visual);
                        }
                        if child_focusable {
                            contains_focusable[parent_idx] = true;
                        }
                    }
                }
            }
        }

        for (idx, entry) in entries.into_iter().enumerate() {
            if self.culled_roots_last_frame.contains(&entry.scroll_root_id) {
                if let Some(prev) = self.boxes.get(&entry.element_id) {
                    let dw = (f32::from(prev.size.width) - f32::from(entry.size.width)).abs();
                    let dh = (f32::from(prev.size.height) - f32::from(entry.size.height)).abs();
                    if dw > 0.5 || dh > 0.5 {
                        size_changed_roots.insert(entry.scroll_root_id);
                    }
                }
            }
            self.boxes.insert(
                entry.element_id,
                CachedBox {
                    scroll_root_id: entry.scroll_root_id,
                    epoch: entry.epoch,
                    subtree_revision: entry.subtree_revision,
                    parent_own_revision: entry.parent_own_revision,
                    ancestor_own_hash: entry.ancestor_own_hash,
                    content_origin: entry.content_origin,
                    size: entry.size,
                    visual_bounds: entry.visual_bounds,
                    contains_focusable: contains_focusable[idx],
                },
            );
        }

        for scroll_root_id in size_changed_roots {
            let gen = self.geometry_gen.entry(scroll_root_id).or_insert(0);
            *gen = gen.wrapping_add(1);
        }
    }

    pub(crate) fn enter_scroll_container(
        &self,
        element: &RetainedElement,
        handle: &ScrollHandle,
        outer_clip: Option<&ActiveScrollClip>,
        window: &Window,
        culling_allowed: bool,
    ) -> ActiveScrollClip {
        let handle_bounds = handle.bounds();
        let own_offset = handle.offset();

        let (live_vp, handles_vec, cumulative_offset) = match outer_clip {
            Some(outer) => {
                let mut handles = Vec::with_capacity(outer.scroll_handles.len() + 1);
                handles.extend(outer.scroll_handles.iter().cloned());
                handles.push(handle.clone());
                let vp = self
                    .boxes
                    .get(&element.id)
                    .filter(|cached| {
                        cached.scroll_root_id == outer.scroll_root_id
                            && cached.epoch == outer.epoch
                    })
                    .map(|cached| Bounds {
                        origin: cached.content_origin + outer.scroll_offset,
                        size: cached.size,
                    })
                    .unwrap_or(handle_bounds);
                (vp, handles, outer.scroll_offset + own_offset)
            }
            None => (handle_bounds, vec![handle.clone()], own_offset),
        };

        let has_bounds = live_vp.size.width > px(0.0) && live_vp.size.height > px(0.0);
        let clip_rect = match outer_clip {
            Some(outer) if outer.culling_enabled && has_bounds => {
                outer.clip_rect.intersect(&live_vp)
            }
            _ => live_vp,
        };
        let win_size = window.viewport_size();
        let gen = self.geometry_gen.get(&element.id).copied().unwrap_or(0);
        let epoch = ViewportEpoch {
            window_w_bits: f32::from(win_size.width).to_bits(),
            window_h_bits: f32::from(win_size.height).to_bits(),
            scale_bits: window.scale_factor().to_bits(),
            rem_bits: f32::from(window.rem_size()).to_bits(),
            scroll_w_bits: f32::from(live_vp.size.width).to_bits(),
            scroll_h_bits: f32::from(live_vp.size.height).to_bits(),
            scroll_own_rev: element.own_revision,
            geometry_gen: gen,
        };

        let culling_enabled = culling_allowed
            && has_bounds
            && outer_clip.map_or(true, |outer| outer.culling_enabled);

        ActiveScrollClip {
            scroll_root_id: element.id,
            clip_rect,
            scroll_offset: cumulative_offset,
            scroll_handles: Rc::from(handles_vec),
            epoch,
            culling_enabled,
        }
    }

    pub(crate) fn should_cull_children_of(
        &self,
        element: &RetainedElement,
        is_scroll_container: bool,
    ) -> bool {
        if is_scroll_container || element.children.len() >= 16 {
            return true;
        }
        if element.children.is_empty() {
            return false;
        }
        // Once a compact card/widget straddling the overscan edge is
        // materialized, build its internal children whole rather than
        // replacing individual icons/labels inside it with spacers.
        match self.boxes.get(&element.id) {
            Some(cached) => {
                f32::from(cached.size.height) > OVERSCAN_PX * 1.5
                    || f32::from(cached.size.width) > OVERSCAN_PX * 2.0
            }
            None => true,
        }
    }

    pub(crate) fn cullable_child(
        &self,
        child: &RetainedElement,
        parent_own_revision: u64,
        ancestor_own_hash: u64,
        clip: &ActiveScrollClip,
        pinned_ancestors: &FxHashSet<u64>,
    ) -> Option<&CachedBox> {
        if !clip.culling_enabled || pinned_ancestors.contains(&child.id) {
            return None;
        }
        if !matches!(child.element_type.as_str(), "div" | "text") {
            return None;
        }
        if child
            .style
            .as_deref()
            .is_some_and(|s| matches!(s.position.as_deref(), Some("fixed" | "sticky")))
        {
            return None;
        }
        let cached = self.boxes.get(&child.id)?;
        if cached.scroll_root_id != clip.scroll_root_id
            || cached.epoch != clip.epoch
            || cached.subtree_revision != child.subtree_revision
            || cached.parent_own_revision != parent_own_revision
            || cached.ancestor_own_hash != ancestor_own_hash
        {
            return None;
        }
        let projected_visual = Bounds {
            origin: cached.visual_bounds.origin + clip.scroll_offset,
            size: cached.visual_bounds.size,
        };
        let keep_zone = clip.clip_rect.dilate(px(OVERSCAN_PX));
        if !projected_visual.intersect(&keep_zone).is_empty() {
            return None;
        }
        Some(cached)
    }

    pub(crate) fn make_single_placeholder(
        &mut self,
        child: &RetainedElement,
        tree: &RetainedTree,
        focus_handles: &HashMap<u64, FocusHandle>,
    ) -> Option<gpui::AnyElement> {
        let cached = self.boxes.get(&child.id)?.clone();
        self.culled_roots_this_frame.insert(cached.scroll_root_id);
        let style = placeholder_style(child.style.as_deref(), cached.size);
        let handles = if cached.contains_focusable {
            self.boundary_focus_handles(&[child.id], tree, focus_handles)
        } else {
            Vec::new()
        };
        Some(
            ViewportSpacerElement {
                id: ElementId::Integer(child.id),
                style,
                focus_handles: handles,
                scroll_root_id: cached.scroll_root_id,
                invalidated: self.invalidated_roots.clone(),
            }
            .into_any_element(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn make_collapsed_run_spacer(
        &mut self,
        parent_id: u64,
        slot: u64,
        child_ids: &[u64],
        style: Style,
        scroll_root_id: u64,
        has_focusable: bool,
        tree: &RetainedTree,
        focus_handles: &HashMap<u64, FocusHandle>,
    ) -> gpui::AnyElement {
        self.culled_roots_this_frame.insert(scroll_root_id);
        let handles = if has_focusable {
            self.boundary_focus_handles(child_ids, tree, focus_handles)
        } else {
            Vec::new()
        };
        let spacer_id =
            (1u64 << 63) ^ parent_id.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(slot);
        ViewportSpacerElement {
            id: ElementId::Integer(spacer_id),
            style,
            focus_handles: handles,
            scroll_root_id,
            invalidated: self.invalidated_roots.clone(),
        }
        .into_any_element()
    }

    fn boundary_focus_handles(
        &mut self,
        child_ids: &[u64],
        tree: &RetainedTree,
        focus_handles: &HashMap<u64, FocusHandle>,
    ) -> Vec<FocusHandle> {
        if tree.focusable_ids.is_empty() || child_ids.is_empty() {
            return Vec::new();
        }
        // O(1) boundary scan: stop at the first focusable from the front and
        // the first focusable from the back; scan interior only when positive
        // tabIndex overrides exist anywhere in the tree.
        let mut first_id: Option<u64> = None;
        for &cid in child_ids {
            if self
                .boxes
                .get(&cid)
                .is_some_and(|cached| !cached.contains_focusable)
            {
                continue;
            }
            let Some(el) = tree.elements.get(&cid) else {
                continue;
            };
            let ids = self.subtree_focusables(cid, el.subtree_revision, tree);
            if let Some(&f) = ids.first() {
                first_id = Some(f);
                break;
            }
        }

        let mut last_id: Option<u64> = None;
        for &cid in child_ids.iter().rev() {
            if self
                .boxes
                .get(&cid)
                .is_some_and(|cached| !cached.contains_focusable)
            {
                continue;
            }
            let Some(el) = tree.elements.get(&cid) else {
                continue;
            };
            let ids = self.subtree_focusables(cid, el.subtree_revision, tree);
            if let Some(&l) = ids.last() {
                last_id = Some(l);
                break;
            }
        }

        let mut positive_tab_ids: Vec<u64> = Vec::new();
        if !tree.positive_tab_ids.is_empty() {
            for &cid in child_ids {
                if self
                    .boxes
                    .get(&cid)
                    .is_some_and(|cached| !cached.contains_focusable)
                {
                    continue;
                }
                let Some(el) = tree.elements.get(&cid) else {
                    continue;
                };
                for &fid in self.subtree_focusables(cid, el.subtree_revision, tree) {
                    if tree.positive_tab_ids.contains(&fid) {
                        positive_tab_ids.push(fid);
                    }
                }
            }
        }

        let mut out = Vec::with_capacity(2 + positive_tab_ids.len());
        if let Some(id) = first_id {
            if let Some(handle) = focus_handles.get(&id) {
                out.push(handle.clone());
            }
        }
        for id in positive_tab_ids {
            if Some(id) != first_id && Some(id) != last_id {
                if let Some(handle) = focus_handles.get(&id) {
                    out.push(handle.clone());
                }
            }
        }
        if let Some(id) = last_id {
            if Some(id) != first_id {
                if let Some(handle) = focus_handles.get(&id) {
                    out.push(handle.clone());
                }
            }
        }
        out
    }

    fn subtree_focusables(&mut self, root_id: u64, rev: u64, tree: &RetainedTree) -> &[u64] {
        let entry = self.focusable_cache.entry(root_id).or_insert_with(|| {
            let mut found = Vec::new();
            collect_focusables_preorder(root_id, tree, &mut found);
            (rev, found)
        });
        if entry.0 != rev {
            entry.1.clear();
            collect_focusables_preorder(root_id, tree, &mut entry.1);
            entry.0 = rev;
        }
        &entry.1
    }
}
