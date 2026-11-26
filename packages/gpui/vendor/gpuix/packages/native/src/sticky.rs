/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

//! Native CSS `position: sticky` support inside GPUIX scroll containers.
//!
//! A sticky element keeps its normal in-flow layout slot (so content sizing,
//! scroll extents, and sibling layout match CSS), then during prepaint clamps
//! its screen position against the enclosing scroll container's viewport
//! (`window.content_mask()`) and optional containing-block bounds. To paint
//! above scrolled siblings (so backdrop blur, progressive blur, and hit-testing
//! see the pinned position) while remaining clipped to the scroll container and
//! below window-level deferred overlays, the sticky subtree is flushed at the
//! end of its scroll container's prepaint and paint passes.

use std::cell::RefCell;
use std::rc::Rc;

use gpui::{
    px, AnyElement, App, Bounds, Edges, Element, ElementId, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, Point, Position, Size, Style, Window,
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct StickyInsets {
    pub top: Option<f32>,
    pub right: Option<f32>,
    pub bottom: Option<f32>,
    pub left: Option<f32>,
}

impl StickyInsets {
    pub(crate) fn from_style(style: &crate::style::StyleDesc) -> Option<Self> {
        if style.position.as_deref() != Some("sticky") {
            return None;
        }
        Some(Self {
            top: style.top.map(|v| v as f32),
            right: style.right.map(|v| v as f32),
            bottom: style.bottom.map(|v| v as f32),
            left: style.left.map(|v| v as f32),
        })
    }

    pub(crate) fn has_any(self) -> bool {
        self.top.is_some()
            || self.right.is_some()
            || self.bottom.is_some()
            || self.left.is_some()
    }
}

struct PendingSticky {
    child: AnyElement,
    absolute_offset: Point<Pixels>,
}

#[derive(Default)]
pub(crate) struct StickyQueue {
    pending: Vec<PendingSticky>,
    containing_blocks: Vec<Bounds<Pixels>>,
}

pub(crate) type StickyQueueHandle = Rc<RefCell<StickyQueue>>;

thread_local! {
    static STICKY_SCOPES: RefCell<Vec<StickyQueueHandle>> = const { RefCell::new(Vec::new()) };
}

struct ScopeGuard(StickyQueueHandle);

impl Drop for ScopeGuard {
    fn drop(&mut self) {
        STICKY_SCOPES.with(|scopes| {
            let mut scopes = scopes.borrow_mut();
            if scopes.last().is_some_and(|top| Rc::ptr_eq(top, &self.0)) {
                scopes.pop();
            }
        });
    }
}

struct ContainingBlockGuard(StickyQueueHandle);

impl Drop for ContainingBlockGuard {
    fn drop(&mut self) {
        self.0.borrow_mut().containing_blocks.pop();
    }
}

/// Computes the `(dx, dy)` translation needed to keep `bounds` pinned within
/// `viewport` according to `insets`, optionally clamped inside `containing_block`.
pub(crate) fn compute_sticky_delta(
    bounds: Bounds<Pixels>,
    viewport: Bounds<Pixels>,
    containing_block: Option<Bounds<Pixels>>,
    insets: StickyInsets,
) -> Point<Pixels> {
    let mut dy = px(0.0);
    if let Some(top) = insets.top {
        let min_y = viewport.origin.y + px(top);
        let mut target_y = bounds.origin.y.max(min_y);
        if let Some(cb) = containing_block {
            let max_y = (cb.bottom() - bounds.size.height).max(bounds.origin.y);
            target_y = target_y.min(max_y);
        }
        dy = target_y - bounds.origin.y;
    } else if let Some(bottom) = insets.bottom {
        let max_bottom = viewport.bottom() - px(bottom);
        let mut target_y = bounds.origin.y.min(max_bottom - bounds.size.height);
        if let Some(cb) = containing_block {
            let min_y = cb.origin.y.min(bounds.origin.y);
            target_y = target_y.max(min_y);
        }
        dy = target_y - bounds.origin.y;
    }

    let mut dx = px(0.0);
    if let Some(left) = insets.left {
        let min_x = viewport.origin.x + px(left);
        let mut target_x = bounds.origin.x.max(min_x);
        if let Some(cb) = containing_block {
            let max_x = (cb.right() - bounds.size.width).max(bounds.origin.x);
            target_x = target_x.min(max_x);
        }
        dx = target_x - bounds.origin.x;
    } else if let Some(right) = insets.right {
        let max_right = viewport.right() - px(right);
        let mut target_x = bounds.origin.x.min(max_right - bounds.size.width);
        if let Some(cb) = containing_block {
            let min_x = cb.origin.x.min(bounds.origin.x);
            target_x = target_x.max(min_x);
        }
        dx = target_x - bounds.origin.x;
    }

    gpui::point(dx, dy)
}

/// Wraps a scroll container so descendant sticky elements register into `queue`
/// during prepaint.
pub(crate) fn wrap_scroll_container(inner: AnyElement, queue: StickyQueueHandle) -> AnyElement {
    StickyContainerWrapper { inner, queue }.into_any_element()
}

/// Zero-size trailing child placed inside a scroll container after normal
/// children (before scroll shadow / scrollbar overlays) to prepaint and paint
/// all sticky descendants on top of scrolled content.
pub(crate) fn sticky_flush_layer(queue: StickyQueueHandle) -> AnyElement {
    StickyFlushElement { queue }.into_any_element()
}

/// Wraps a non-scroll parent that has a sticky child so sticky clamping obeys
/// the containing block's edges.
pub(crate) fn wrap_containing_block(inner: AnyElement) -> AnyElement {
    StickyContainingBlock { inner }.into_any_element()
}

/// Wraps a `position: sticky` element so it keeps its in-flow layout box and
/// pins inside its nearest scroll container during prepaint/paint.
pub(crate) fn wrap_sticky_element(child: AnyElement, insets: StickyInsets) -> AnyElement {
    StickyElement {
        child: Some(child),
        insets,
    }
    .into_any_element()
}

struct StickyContainerWrapper {
    inner: AnyElement,
    queue: StickyQueueHandle,
}

impl Element for StickyContainerWrapper {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.inner.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        {
            let mut q = self.queue.borrow_mut();
            q.pending.clear();
            q.containing_blocks.clear();
        }
        STICKY_SCOPES.with(|scopes| scopes.borrow_mut().push(self.queue.clone()));
        let _guard = ScopeGuard(self.queue.clone());
        self.inner.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        _prepaint: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.inner.paint(window, cx);
    }
}

impl IntoElement for StickyContainerWrapper {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

struct StickyContainingBlock {
    inner: AnyElement,
}

impl Element for StickyContainingBlock {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.inner.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let active_queue = STICKY_SCOPES.with(|scopes| scopes.borrow().last().cloned());
        let _guard = active_queue.map(|queue| {
            queue.borrow_mut().containing_blocks.push(bounds);
            ContainingBlockGuard(queue)
        });
        self.inner.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        _prepaint: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.inner.paint(window, cx);
    }
}

impl IntoElement for StickyContainingBlock {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

struct StickyElement {
    child: Option<AnyElement>,
    insets: StickyInsets,
}

impl Element for StickyElement {
    type RequestLayoutState = ();
    type PrepaintState = Option<AnyElement>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let layout_id = self
            .child
            .as_mut()
            .expect("sticky child present during request_layout")
            .request_layout(window, cx);
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Option<AnyElement> {
        let mut child = self
            .child
            .take()
            .expect("sticky child present during prepaint");

        let active_queue = STICKY_SCOPES.with(|scopes| scopes.borrow().last().cloned());
        let Some(queue) = active_queue else {
            child.prepaint(window, cx);
            return Some(child);
        };

        let viewport = window.content_mask().bounds;
        let containing_block = queue.borrow().containing_blocks.last().copied();
        let delta = if self.insets.has_any() {
            compute_sticky_delta(bounds, viewport, containing_block, self.insets)
        } else {
            gpui::point(px(0.0), px(0.0))
        };
        let absolute_offset = window.element_offset() + delta;

        queue.borrow_mut().pending.push(PendingSticky {
            child,
            absolute_offset,
        });
        None
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        inline_child: &mut Option<AnyElement>,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(child) = inline_child.as_mut() {
            child.paint(window, cx);
        }
    }
}

impl IntoElement for StickyElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

struct StickyFlushElement {
    queue: StickyQueueHandle,
}

impl Element for StickyFlushElement {
    type RequestLayoutState = ();
    type PrepaintState = Vec<AnyElement>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let style = Style {
            position: Position::Absolute,
            inset: Edges {
                top: px(0.0).into(),
                left: px(0.0).into(),
                right: gpui::Length::Auto,
                bottom: gpui::Length::Auto,
            },
            size: Size {
                width: px(0.0).into(),
                height: px(0.0).into(),
            },
            ..Style::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Vec<AnyElement> {
        // Pop our scope before prepainting drained sticky items so descendants
        // inside a sticky layer cannot re-queue into this already-flushing scope.
        STICKY_SCOPES.with(|scopes| {
            let mut scopes = scopes.borrow_mut();
            if scopes.last().is_some_and(|top| Rc::ptr_eq(top, &self.queue)) {
                scopes.pop();
            }
        });

        let pending = std::mem::take(&mut self.queue.borrow_mut().pending);
        let mut ready = Vec::with_capacity(pending.len());
        for mut item in pending {
            window.with_absolute_element_offset(item.absolute_offset, |window| {
                item.child.prepaint(window, cx);
            });
            ready.push(item.child);
        }
        ready
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut (),
        ready: &mut Vec<AnyElement>,
        window: &mut Window,
        cx: &mut App,
    ) {
        for child in ready.iter_mut() {
            child.paint(window, cx);
        }
    }
}

impl IntoElement for StickyFlushElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f32, y: f32, w: f32, h: f32) -> Bounds<Pixels> {
        Bounds {
            origin: gpui::point(px(x), px(y)),
            size: gpui::size(px(w), px(h)),
        }
    }

    #[test]
    fn sticky_top_does_not_shift_before_threshold() {
        let delta = compute_sticky_delta(
            rect(32.0, 170.0, 600.0, 90.0),
            rect(0.0, 61.0, 1000.0, 780.0),
            Some(rect(32.0, 88.0, 600.0, 2000.0)),
            StickyInsets {
                top: Some(0.0),
                ..Default::default()
            },
        );
        assert_eq!(delta, gpui::point(px(0.0), px(0.0)));
    }

    #[test]
    fn sticky_top_pins_to_scrollport_top_when_scrolled_past() {
        let delta = compute_sticky_delta(
            rect(32.0, -150.0, 600.0, 90.0),
            rect(0.0, 61.0, 1000.0, 780.0),
            Some(rect(32.0, -232.0, 600.0, 2000.0)),
            StickyInsets {
                top: Some(0.0),
                ..Default::default()
            },
        );
        // -150 + 211 = 61 (flush with scrollport top)
        assert_eq!(delta, gpui::point(px(0.0), px(211.0)));
    }

    #[test]
    fn sticky_top_clamps_to_containing_block_bottom() {
        // Containing block scrolled almost completely off-screen: bottom at y = 100, height of sticky = 90 -> max_y = 10
        let delta = compute_sticky_delta(
            rect(32.0, -200.0, 600.0, 90.0),
            rect(0.0, 61.0, 1000.0, 780.0),
            Some(rect(32.0, -200.0, 600.0, 300.0)),
            StickyInsets {
                top: Some(0.0),
                ..Default::default()
            },
        );
        // cb.bottom() = 100, max_y = 10, dy = 10 - (-200) = 210
        assert_eq!(delta, gpui::point(px(0.0), px(210.0)));
    }

    #[test]
    fn sticky_bottom_pins_to_scrollport_bottom() {
        let delta = compute_sticky_delta(
            rect(0.0, 900.0, 400.0, 50.0),
            rect(0.0, 0.0, 400.0, 600.0),
            None,
            StickyInsets {
                bottom: Some(12.0),
                ..Default::default()
            },
        );
        // max_bottom = 588, target_y = 538, dy = 538 - 900 = -362
        assert_eq!(delta, gpui::point(px(0.0), px(-362.0)));
    }
}
