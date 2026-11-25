use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;

use crate::scroll_shadow::ScrollEdgeOpacities;
use crate::style::ScrollBindDesc;

#[derive(Debug, Clone, Default)]
#[cfg_attr(
    all(target_arch = "wasm32", target_os = "unknown"),
    derive(serde::Serialize)
)]
#[cfg_attr(
    all(target_arch = "wasm32", target_os = "unknown"),
    serde(rename_all = "camelCase")
)]
#[cfg_attr(not(all(target_arch = "wasm32", target_os = "unknown")), napi(object))]
pub struct NativeScrollState {
    /// Current horizontal offset (0 at left edge, negative when scrolled right).
    pub offset_x: f64,
    /// Current vertical offset (0 at top edge, negative when scrolled down).
    pub offset_y: f64,
    /// Maximum positive horizontal scroll extent (`>= 0`).
    pub max_x: f64,
    /// Maximum positive vertical scroll extent (`>= 0`).
    pub max_y: f64,
    pub content_width: f64,
    pub content_height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    /// Normalized horizontal scroll progress in `[0, 1]`.
    pub progress_x: f64,
    /// Normalized vertical scroll progress in `[0, 1]`.
    pub progress_y: f64,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub can_scroll_top: bool,
    pub can_scroll_bottom: bool,
    pub can_scroll_left: bool,
    pub can_scroll_right: bool,
    pub is_scrolling: bool,
    pub top_shadow_opacity: f64,
    pub bottom_shadow_opacity: f64,
    pub left_shadow_opacity: f64,
    pub right_shadow_opacity: f64,
}

struct ScrollEntry {
    state: NativeScrollState,
    handle: gpui::ScrollHandle,
    scroll_id: Option<String>,
    last_offset: (f64, f64),
    last_time: web_time::Instant,
}

#[derive(Default)]
struct ScrollRegistry {
    by_element: HashMap<u64, ScrollEntry>,
    id_to_element: HashMap<String, u64>,
}

thread_local! {
    static SCROLL_REGISTRY: RefCell<ScrollRegistry> = RefCell::new(ScrollRegistry::default());
}

const SCROLL_ACTIVE_WINDOW_MS: u128 = 120;

pub(crate) fn prune_scroll_registry(active_ids: &HashSet<u64>) {
    SCROLL_REGISTRY.with(|cell| {
        let mut reg = cell.borrow_mut();
        reg.by_element.retain(|id, _| active_ids.contains(id));
        reg.id_to_element.retain(|_, elem_id| active_ids.contains(elem_id));
    });
}

pub(crate) fn update_scroll_state(
    element_id: u64,
    scroll_id: Option<&str>,
    handle: &gpui::ScrollHandle,
    viewport: gpui::Size<gpui::Pixels>,
    offset: gpui::Point<gpui::Pixels>,
    max_offset: gpui::Point<gpui::Pixels>,
    shadow_opacities: ScrollEdgeOpacities,
    now: web_time::Instant,
) {
    let vp_w = (f32::from(viewport.width) as f64).max(0.0);
    let vp_h = (f32::from(viewport.height) as f64).max(0.0);
    let max_x = (f32::from(max_offset.x) as f64).max(0.0);
    let max_y = (f32::from(max_offset.y) as f64).max(0.0);
    let off_x = (f32::from(offset.x) as f64).clamp(-max_x, 0.0);
    let off_y = (f32::from(offset.y) as f64).clamp(-max_y, 0.0);
    let scrolled_x = (-off_x).clamp(0.0, max_x);
    let scrolled_y = (-off_y).clamp(0.0, max_y);

    let progress_x = if max_x > 0.5 {
        (scrolled_x / max_x).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let progress_y = if max_y > 0.5 {
        (scrolled_y / max_y).clamp(0.0, 1.0)
    } else {
        0.0
    };

    SCROLL_REGISTRY.with(|cell| {
        let mut reg = cell.borrow_mut();

        let (prev_off, prev_time, prev_scroll_id) = reg
            .by_element
            .get(&element_id)
            .map(|e| (e.last_offset, e.last_time, e.scroll_id.clone()))
            .unwrap_or(((off_x, off_y), now, None));

        if let Some(old_id) = prev_scroll_id.as_deref() {
            if Some(old_id) != scroll_id && reg.id_to_element.get(old_id) == Some(&element_id) {
                reg.id_to_element.remove(old_id);
            }
        }
        if let Some(id_str) = scroll_id {
            reg.id_to_element.insert(id_str.to_string(), element_id);
        }

        let moved = (off_x - prev_off.0).abs() > 0.01 || (off_y - prev_off.1).abs() > 0.01;
        let dt_secs = now.saturating_duration_since(prev_time).as_secs_f64();
        let (vx, vy, next_time, is_scrolling) = if moved && dt_secs > 1e-4 {
            (
                (prev_off.0 - off_x) / dt_secs,
                (prev_off.1 - off_y) / dt_secs,
                now,
                true,
            )
        } else if moved {
            (0.0, 0.0, now, true)
        } else {
            let still_active = now.saturating_duration_since(prev_time).as_millis() <= SCROLL_ACTIVE_WINDOW_MS;
            (0.0, 0.0, prev_time, still_active)
        };

        let state = NativeScrollState {
            offset_x: off_x,
            offset_y: off_y,
            max_x,
            max_y,
            content_width: vp_w + max_x,
            content_height: vp_h + max_y,
            viewport_width: vp_w,
            viewport_height: vp_h,
            progress_x,
            progress_y,
            velocity_x: vx,
            velocity_y: vy,
            can_scroll_top: scrolled_y > 0.5,
            can_scroll_bottom: (max_y - scrolled_y) > 0.5,
            can_scroll_left: scrolled_x > 0.5,
            can_scroll_right: (max_x - scrolled_x) > 0.5,
            is_scrolling,
            top_shadow_opacity: f64::from(shadow_opacities.top),
            bottom_shadow_opacity: f64::from(shadow_opacities.bottom),
            left_shadow_opacity: f64::from(shadow_opacities.left),
            right_shadow_opacity: f64::from(shadow_opacities.right),
        };

        reg.by_element.insert(
            element_id,
            ScrollEntry {
                state,
                handle: handle.clone(),
                scroll_id: scroll_id.map(ToOwned::to_owned),
                last_offset: (off_x, off_y),
                last_time: next_time,
            },
        );
    });
}

pub(crate) fn get_scroll_state_by_id(scroll_id: &str) -> Option<NativeScrollState> {
    SCROLL_REGISTRY.with(|cell| {
        let reg = cell.borrow();
        let elem_id = reg.id_to_element.get(scroll_id)?;
        let entry = reg.by_element.get(elem_id)?;
        let mut state = entry.state.clone();
        // Refresh offset/progress/flags directly from the live ScrollHandle so
        // callers and sibling `scrollBind` elements read zero-lag values even
        // before the scrollable container paints this frame.
        let max = entry.handle.max_offset();
        let off = entry.handle.offset();
        let max_x = (f32::from(max.x) as f64).max(0.0).max(state.max_x);
        let max_y = (f32::from(max.y) as f64).max(0.0).max(state.max_y);
        let off_x = if max_x > 0.0 {
            (f32::from(off.x) as f64).clamp(-max_x, 0.0)
        } else {
            f32::from(off.x) as f64
        };
        let off_y = if max_y > 0.0 {
            (f32::from(off.y) as f64).clamp(-max_y, 0.0)
        } else {
            f32::from(off.y) as f64
        };
        let sx = (-off_x).max(0.0);
        let sy = (-off_y).max(0.0);
        state.offset_x = off_x;
        state.offset_y = off_y;
        state.max_x = max_x;
        state.max_y = max_y;
        state.progress_x = if max_x > 0.5 { (sx / max_x).clamp(0.0, 1.0) } else { 0.0 };
        state.progress_y = if max_y > 0.5 { (sy / max_y).clamp(0.0, 1.0) } else { 0.0 };
        state.can_scroll_top = sy > 0.5;
        state.can_scroll_bottom = (max_y - sy) > 0.5;
        state.can_scroll_left = sx > 0.5;
        state.can_scroll_right = (max_x - sx) > 0.5;
        Some(state)
    })
}

pub(crate) fn scroll_to_by_id(scroll_id: &str, x: f64, y: f64) -> bool {
    SCROLL_REGISTRY.with(|cell| {
        let reg = cell.borrow();
        let Some(elem_id) = reg.id_to_element.get(scroll_id) else {
            return false;
        };
        let Some(entry) = reg.by_element.get(elem_id) else {
            return false;
        };
        let max = entry.handle.max_offset();
        let clamped_x = (x as f32).clamp(-f32::from(max.x).max(0.0), 0.0);
        let clamped_y = (y as f32).clamp(-f32::from(max.y).max(0.0), 0.0);
        entry
            .handle
            .set_offset(gpui::point(gpui::px(clamped_x), gpui::px(clamped_y)));
        true
    })
}

fn read_metric(state: &NativeScrollState, metric: &str) -> f64 {
    match metric {
        "progressY" => state.progress_y,
        "progressX" => state.progress_x,
        "offsetY" => -state.offset_y,
        "offsetX" => -state.offset_x,
        "maxY" => state.max_y,
        "maxX" => state.max_x,
        "velocityY" => state.velocity_y,
        "velocityX" => state.velocity_x,
        "canScrollTop" => if state.can_scroll_top { 1.0 } else { 0.0 },
        "canScrollBottom" => if state.can_scroll_bottom { 1.0 } else { 0.0 },
        "canScrollLeft" => if state.can_scroll_left { 1.0 } else { 0.0 },
        "canScrollRight" => if state.can_scroll_right { 1.0 } else { 0.0 },
        "topShadowOpacity" => state.top_shadow_opacity,
        "bottomShadowOpacity" => state.bottom_shadow_opacity,
        "leftShadowOpacity" => state.left_shadow_opacity,
        "rightShadowOpacity" => state.right_shadow_opacity,
        _ => 0.0,
    }
}

fn interpolate(value: f64, input: [f64; 2], output: [f64; 2], clamp: bool) -> f64 {
    let span = input[1] - input[0];
    let mut t = if span.abs() < 1e-9 {
        if value >= input[1] { 1.0 } else { 0.0 }
    } else {
        (value - input[0]) / span
    };
    if clamp {
        t = t.clamp(0.0, 1.0);
    }
    output[0] + t * (output[1] - output[0])
}

pub(crate) fn apply_scroll_bindings_to_style(
    style: &mut crate::style::StyleDesc,
    bindings: &[ScrollBindDesc],
) {
    for bind in bindings {
        let state = get_scroll_state_by_id(&bind.source_id).unwrap_or_default();
        let raw = read_metric(&state, &bind.metric);
        let mapped = interpolate(
            raw,
            bind.input_range,
            bind.output_range,
            bind.clamp.unwrap_or(true),
        );
        crate::motion::apply_scalar_property(style, &bind.property, mapped);
    }
}
