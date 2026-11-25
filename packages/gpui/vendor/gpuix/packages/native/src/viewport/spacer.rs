//! Lightweight geometry-preserving GPUI element and style helpers for native
//! offscreen viewport virtualization.

use std::cell::RefCell;
use std::rc::Rc;

use gpui::{
    px, AbsoluteLength, AlignSelf, App, Bounds, DefiniteLength, Display, Edges, Element, ElementId,
    FocusHandle, GlobalElementId, GridLocation, GridPlacement, InspectorElementId, IntoElement,
    LayoutId, Length, Pixels, Position, Size, Style, Window,
};
use rustc_hash::FxHashSet;

use crate::style::StyleDesc;

/// Self-heal trigger band inside `Element::prepaint`. Strictly smaller than
/// `OVERSCAN_PX` so subpixel rounding near the build boundary cannot oscillate.
const SELF_HEAL_MARGIN_PX: f32 = 128.0;

pub(crate) fn clips_children(style: Option<&StyleDesc>) -> bool {
    let Some(s) = style else {
        return false;
    };
    let rx = s.overflow_x.as_deref().or(s.overflow.as_deref());
    let ry = s.overflow_y.as_deref().or(s.overflow.as_deref());
    matches!(rx, Some("hidden" | "scroll" | "clip"))
        && matches!(ry, Some("hidden" | "scroll" | "clip"))
}

pub(crate) fn visual_margin_of(style: Option<&StyleDesc>) -> Pixels {
    let Some(s) = style else {
        return px(0.0);
    };
    let mut margin: f32 = 0.0;
    if let Some(shadows) = s.box_shadow.as_ref() {
        for sh in shadows.as_slice() {
            if !sh.inset {
                let reach = (sh.spread_radius.max(0.0)
                    + sh.blur_radius.max(0.0) * 3.0
                    + sh.offset_x.abs().max(sh.offset_y.abs())
                    + 2.0) as f32;
                margin = margin.max(reach);
            }
        }
    }
    if let Some(glow) = s.glow.as_ref() {
        if !glow.inset {
            let reach = (glow.spread.unwrap_or(0.0).max(0.0) + glow.radius.max(0.0) * 3.0) as f32;
            margin = margin.max(reach);
        }
    }
    if let Some(blur) = s.blur {
        margin = margin.max((blur.max(0.0) * 3.0) as f32);
    }
    if let Some(ow) = s.outline_width {
        let reach = (ow.max(0.0) + s.outline_offset.unwrap_or(0.0).max(0.0)) as f32;
        margin = margin.max(reach);
    }
    if let Some(tx) = s.transform.as_ref() {
        let shift = tx
            .translate_x
            .unwrap_or(0.0)
            .abs()
            .max(tx.translate_y.unwrap_or(0.0).abs()) as f32;
        let mat_shift = tx
            .matrix
            .map(|m| m[4].abs().max(m[5].abs()) as f32)
            .unwrap_or(0.0);
        margin = margin.max(shift + mat_shift + 64.0);
    }
    px(margin)
}

pub(crate) fn margins_of(style: Option<&StyleDesc>) -> Edges<f32> {
    let Some(s) = style else {
        return Edges::default();
    };
    let base = s.margin.unwrap_or(0.0) as f32;
    Edges {
        top: s.margin_top.map(|v| v as f32).unwrap_or(base),
        right: s.margin_right.map(|v| v as f32).unwrap_or(base),
        bottom: s.margin_bottom.map(|v| v as f32).unwrap_or(base),
        left: s.margin_left.map(|v| v as f32).unwrap_or(base),
    }
}

pub(crate) fn has_negative_margin(m: Edges<f32>) -> bool {
    m.top < 0.0 || m.right < 0.0 || m.bottom < 0.0 || m.left < 0.0
}

pub(crate) fn grid_spacer_style(cols: usize, height: Pixels) -> Style {
    let mut style = Style::default();
    style.display = Display::Block;
    style.size.width = Length::Definite(DefiniteLength::Fraction(1.0));
    style.size.height = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(height)));
    style.min_size.height = style.size.height;
    // Use Span..Span (no definite Line) so CSS Grid auto-placement keeps the
    // spacer in exact DOM order rather than jumping ahead of auto-placed rows.
    style.grid_location = Some(GridLocation {
        row: GridPlacement::Auto..GridPlacement::Auto,
        column: GridPlacement::Span(cols as u16)..GridPlacement::Span(cols as u16),
    });
    style
}

pub(crate) fn flex_column_spacer_style(height: Pixels, width: Pixels) -> Style {
    let mut style = Style::default();
    style.display = Display::Block;
    style.size.height = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(height)));
    style.min_size.height = style.size.height;
    if width > px(0.0) {
        style.size.width = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(width)));
    }
    style.flex_shrink = 0.0;
    style
}

pub(crate) fn flex_row_spacer_style(width: Pixels, height: Pixels) -> Style {
    let mut style = Style::default();
    style.display = Display::Block;
    style.size.width = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(width)));
    style.min_size.width = style.size.width;
    if height > px(0.0) {
        style.size.height =
            Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(height)));
    }
    style.flex_shrink = 0.0;
    style
}

pub(crate) fn placeholder_style(desc: Option<&StyleDesc>, size: Size<Pixels>) -> Style {
    let mut style = Style::default();
    style.display = Display::Block;
    style.size.width = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(
        size.width,
    )));
    style.size.height = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(
        size.height,
    )));
    style.min_size = style.size;
    style.flex_shrink = 0.0;

    if let Some(s) = desc {
        let m = margins_of(Some(s));
        style.margin = Edges {
            top: Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(px(m.top)))),
            right: Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(px(
                m.right,
            )))),
            bottom: Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(px(
                m.bottom,
            )))),
            left: Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(px(m.left)))),
        };
        if s.position.as_deref() == Some("absolute") {
            style.position = Position::Absolute;
        }
        if let Some(v) = s.top {
            style.inset.top = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(
                px(v as f32),
            )));
        }
        if let Some(v) = s.right {
            style.inset.right = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(
                px(v as f32),
            )));
        }
        if let Some(v) = s.bottom {
            style.inset.bottom = Length::Definite(DefiniteLength::Absolute(
                AbsoluteLength::Pixels(px(v as f32)),
            ));
        }
        if let Some(v) = s.left {
            style.inset.left = Length::Definite(DefiniteLength::Absolute(AbsoluteLength::Pixels(
                px(v as f32),
            )));
        }
        style.align_self = match s.align_self.as_deref() {
            Some("flex-start" | "start") => Some(AlignSelf::FlexStart),
            Some("flex-end" | "end") => Some(AlignSelf::FlexEnd),
            Some("center") => Some(AlignSelf::Center),
            Some("stretch") => Some(AlignSelf::Stretch),
            Some("baseline") => Some(AlignSelf::Baseline),
            _ => None,
        };
    }
    style
}

pub(crate) struct ViewportSpacerElement {
    pub id: ElementId,
    pub style: Style,
    pub focus_handles: Vec<FocusHandle>,
    pub scroll_root_id: u64,
    pub invalidated: Rc<RefCell<FxHashSet<u64>>>,
}

impl IntoElement for ViewportSpacerElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for ViewportSpacerElement {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let layout_id = window.request_layout(self.style.clone(), None, cx);
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        _cx: &mut App,
    ) -> Self::PrepaintState {
        // Self-healing guard: if an upstream layout change moved this culled
        // placeholder into the viewport on this frame, invalidate the scroll
        // root's cached geometry and refresh immediately.
        // An empty content mask means an ancestor clip already hides this
        // entire region; never dilate an empty rect into a non-empty trigger.
        let mask = window.content_mask().bounds;
        if mask.is_empty() {
            return;
        }
        let trigger_zone = mask.dilate(px(SELF_HEAL_MARGIN_PX));
        if !bounds.intersect(&trigger_zone).is_empty() {
            self.invalidated.borrow_mut().insert(self.scroll_root_id);
            window.refresh();
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        _cx: &mut App,
    ) {
        for handle in &self.focus_handles {
            window.register_tab_stop(handle);
        }
    }
}
