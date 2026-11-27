//! `CachedSubtreeElement`: GPUI `Element` wrapper that records and replays
//! `prepaint` / `paint` ranges and synchronized GPUIX side tables in `O(1)`.

use gpui::{
    AnyElement, App, Bounds, Element, ElementId, EntityId, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, PaintIndex, Pixels, Point, Size, Style, WeakEntity, Window,
};
use rustc_hash::FxHashSet;

use super::subtree::{
    SharedSubtreeCache, SubtreeCacheKey, SubtreeFallbackSpec, SubtreeRecord,
};
use crate::automation::{bounds_log_len, replay_bounds_range};
use crate::renderer::GpuixView;
use crate::text::paint::{replay_text_paint_range, text_paint_checkpoint, TextPaintCheckpoint};

#[inline]
fn canonical_origin_bits(origin: Point<f32>) -> (u32, u32) {
    let x = if origin.x == 0.0 { 0 } else { origin.x.to_bits() };
    let y = if origin.y == 0.0 { 0 } else { origin.y.to_bits() };
    (x, y)
}

enum SubtreeMode {
    Record {
        inner: Option<AnyElement>,
        base_outer_style: Style,
        blocked: bool,
        element_count: u64,
    },
    Replay {
        outer_style: Style,
        raw_device_size: Size<f32>,
        weak_view: WeakEntity<GpuixView>,
        fallback: SubtreeFallbackSpec,
    },
}

pub(crate) struct CachedSubtreeElement {
    cache_id: u64,
    key: SubtreeCacheKey,
    cache: SharedSubtreeCache,
    gpuix_view_id: EntityId,
    mode: SubtreeMode,
}

impl CachedSubtreeElement {
    #[allow(clippy::too_many_arguments)]
    pub fn recording(
        cache_id: u64,
        key: SubtreeCacheKey,
        cache: SharedSubtreeCache,
        gpuix_view_id: EntityId,
        inner: AnyElement,
        base_outer_style: Style,
        blocked: bool,
        element_count: u64,
    ) -> Self {
        Self {
            cache_id,
            key,
            cache,
            gpuix_view_id,
            mode: SubtreeMode::Record {
                inner: Some(inner),
                base_outer_style,
                blocked,
                element_count,
            },
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn replaying(
        cache_id: u64,
        key: SubtreeCacheKey,
        cache: SharedSubtreeCache,
        gpuix_view_id: EntityId,
        outer_style: Style,
        raw_device_size: Size<f32>,
        weak_view: WeakEntity<GpuixView>,
        fallback: SubtreeFallbackSpec,
    ) -> Self {
        Self {
            cache_id,
            key,
            cache,
            gpuix_view_id,
            mode: SubtreeMode::Replay {
                outer_style,
                raw_device_size,
                weak_view,
                fallback,
            },
        }
    }
}

pub(crate) enum SubtreeLayoutState {
    Recorded {
        layout_id: LayoutId,
        inner: AnyElement,
        layout_entities: FxHashSet<EntityId>,
        base_outer_style: Style,
        blocked: bool,
        element_count: u64,
    },
    Replaying {
        layout_id: LayoutId,
        weak_view: WeakEntity<GpuixView>,
        fallback: SubtreeFallbackSpec,
    },
}

pub(crate) enum SubtreePrepaintState {
    Painted(AnyElement),
    Replayed,
}

impl IntoElement for CachedSubtreeElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for CachedSubtreeElement {
    type RequestLayoutState = SubtreeLayoutState;
    type PrepaintState = SubtreePrepaintState;

    fn id(&self) -> Option<ElementId> {
        match self.mode {
            SubtreeMode::Record { .. } => None,
            SubtreeMode::Replay { .. } => Some(ElementId::Integer(self.cache_id | (1_u64 << 63))),
        }
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
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mode = std::mem::replace(
            &mut self.mode,
            SubtreeMode::Record {
                inner: None,
                base_outer_style: Style::default(),
                blocked: true,
                element_count: 0,
            },
        );
        match mode {
            SubtreeMode::Record {
                mut inner,
                base_outer_style,
                blocked,
                element_count,
            } => {
                let mut element = inner.take().expect("recording subtree has inner element");
                let (layout_id, layout_entities) =
                    cx.detect_accessed_entities(|cx| element.request_layout(window, cx));
                (
                    layout_id,
                    SubtreeLayoutState::Recorded {
                        layout_id,
                        inner: element,
                        layout_entities,
                        base_outer_style,
                        blocked,
                        element_count,
                    },
                )
            }
            SubtreeMode::Replay {
                outer_style,
                raw_device_size,
                weak_view,
                fallback,
            } => {
                let layout_id = window.request_replayed_layout(outer_style, raw_device_size);
                (
                    layout_id,
                    SubtreeLayoutState::Replaying {
                        layout_id,
                        weak_view,
                        fallback,
                    },
                )
            }
        }
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let content_mask = window.content_mask();
        let text_style = window.text_style();
        let rem_size = window.rem_size();
        let scale_bits = window.scale_factor().to_bits();

        match request_layout {
            SubtreeLayoutState::Recorded {
                layout_id,
                inner,
                layout_entities,
                base_outer_style,
                blocked,
                element_count,
            } => {
                let (raw_origin, raw_device_size) = window.raw_layout_geometry(*layout_id);
                let raw_origin_bits = canonical_origin_bits(raw_origin);
                let prepaint_start = window.prepaint_checkpoint();
                let (_, prepaint_entities) =
                    cx.detect_accessed_entities(|cx| inner.prepaint(window, cx));
                let prepaint_end = window.prepaint_checkpoint();

                let mut accessed = std::mem::take(layout_entities);
                accessed.extend(prepaint_entities);
                accessed.remove(&self.gpuix_view_id);

                let has_deferred = prepaint_start.has_deferred_draws(&prepaint_end);
                let replayable = !*blocked && !has_deferred;

                self.cache.borrow_mut().records.insert(
                    self.cache_id,
                    SubtreeRecord {
                        key: self.key,
                        recorded_frame: window.drawn_frames(),
                        painted_frame: None,
                        bounds,
                        raw_origin_bits,
                        raw_device_size,
                        content_mask,
                        text_style,
                        rem_size,
                        scale_bits,
                        opacity: window.element_opacity(),
                        outer_style: base_outer_style.clone(),
                        accessed_entities: accessed,
                        prepaint_range: prepaint_start..prepaint_end,
                        paint_range: PaintIndex::default()..PaintIndex::default(),
                        bounds_log_range: 0..0,
                        text_paint_range: (
                            TextPaintCheckpoint::default(),
                            TextPaintCheckpoint::default(),
                        ),
                        element_count: *element_count,
                        replayable,
                    },
                );

                let dummy = gpui::Empty.into_any_element();
                SubtreePrepaintState::Painted(std::mem::replace(inner, dummy))
            }
            SubtreeLayoutState::Replaying {
                layout_id,
                weak_view,
                fallback,
            } => {
                let (raw_origin, raw_device_size) = window.raw_layout_geometry(*layout_id);
                let raw_origin_bits = canonical_origin_bits(raw_origin);
                let replay_check = {
                    let cache = self.cache.borrow();
                    cache.records.get(&self.cache_id).and_then(|record| {
                        let valid = record.replayable
                            && record.key == self.key
                            && record.painted_frame == Some(record.recorded_frame)
                            && window.can_replay_subtree(record.recorded_frame)
                            && record.bounds == bounds
                            && record.raw_origin_bits == raw_origin_bits
                            && record.content_mask == content_mask
                            && record.text_style == text_style
                            && record.rem_size == rem_size
                            && record.scale_bits == scale_bits
                            && !window.has_any_dirty_view(&record.accessed_entities);
                        valid.then(|| {
                            (
                                record.prepaint_range.clone(),
                                record.accessed_entities.clone(),
                                record.element_count,
                            )
                        })
                    })
                };

                if let Some((prepaint_range, accessed_entities, element_count)) = replay_check {
                    let new_range = window.replay_prepaint(prepaint_range, &accessed_entities, cx);
                    let mut cache = self.cache.borrow_mut();
                    if let Some(record) = cache.records.get_mut(&self.cache_id) {
                        record.prepaint_range = new_range;
                        record.recorded_frame = window.drawn_frames();
                    }
                    cache.replayed_subtrees_this_frame =
                        cache.replayed_subtrees_this_frame.saturating_add(1);
                    cache.replayed_elements_this_frame = cache
                        .replayed_elements_this_frame
                        .saturating_add(element_count);
                    crate::perf::add_frame_replayed_stats(1, element_count);
                    return SubtreePrepaintState::Replayed;
                }

                let fallback_spec = fallback.clone();
                let view_handle = weak_view.clone();
                let prepaint_start = window.prepaint_checkpoint();
                let (built_opt, mut accessed) = cx.detect_accessed_entities(|cx| {
                    let built = view_handle
                        .update(cx, |view, cx| {
                            view.build_fallback_subtree(&fallback_spec, bounds.size, window, cx)
                        })
                        .ok();
                    built.map(|(mut element, base_style, _blocked, count)| {
                        element.layout_as_root(bounds.size.into(), window, cx);
                        element.prepaint_at(bounds.origin, window, cx);
                        (element, base_style, count)
                    })
                });
                let prepaint_end = window.prepaint_checkpoint();
                accessed.remove(&self.gpuix_view_id);
                window.mark_faded_view(self.gpuix_view_id);

                if let Some((element, outer_style, count)) = built_opt {
                    self.cache.borrow_mut().records.insert(
                        self.cache_id,
                        SubtreeRecord {
                            key: self.key,
                            recorded_frame: window.drawn_frames(),
                            painted_frame: None,
                            bounds,
                            raw_origin_bits,
                            raw_device_size,
                            content_mask,
                            text_style,
                            rem_size,
                            scale_bits,
                            opacity: window.element_opacity(),
                            outer_style,
                            accessed_entities: accessed,
                            prepaint_range: prepaint_start..prepaint_end,
                            paint_range: PaintIndex::default()..PaintIndex::default(),
                            bounds_log_range: 0..0,
                            text_paint_range: (
                                TextPaintCheckpoint::default(),
                                TextPaintCheckpoint::default(),
                            ),
                            element_count: count,
                            replayable: false,
                        },
                    );
                    SubtreePrepaintState::Painted(element)
                } else {
                    SubtreePrepaintState::Painted(gpui::Empty.into_any_element())
                }
            }
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let opacity = window.element_opacity();
        match prepaint {
            SubtreePrepaintState::Painted(element) => {
                let paint_start = window.paint_checkpoint();
                let bounds_start = bounds_log_len();
                let text_start = text_paint_checkpoint();

                element.paint(window, cx);

                let paint_end = window.paint_checkpoint();
                let bounds_end = bounds_log_len();
                let text_end = text_paint_checkpoint();

                if let Some(record) = self.cache.borrow_mut().records.get_mut(&self.cache_id) {
                    record.paint_range = paint_start..paint_end;
                    record.bounds_log_range = bounds_start..bounds_end;
                    record.text_paint_range = (text_start, text_end);
                    record.opacity = opacity;
                    record.painted_frame = Some(window.drawn_frames());
                }
            }
            SubtreePrepaintState::Replayed => {
                let ranges = {
                    let cache = self.cache.borrow();
                    cache.records.get(&self.cache_id).map(|record| {
                        (
                            record.paint_range.clone(),
                            record.bounds_log_range.clone(),
                            record.text_paint_range,
                            record.opacity,
                        )
                    })
                };
                if let Some((paint_range, bounds_range, (text_start, text_end), prev_opacity)) =
                    ranges
                {
                    let new_paint = window.replay_paint(paint_range);
                    let new_bounds = replay_bounds_range(bounds_range);
                    let new_text = replay_text_paint_range(&text_start, &text_end);
                    if (prev_opacity - opacity).abs() > 1e-5 {
                        window.mark_faded_view(self.gpuix_view_id);
                    }
                    if let Some(record) = self.cache.borrow_mut().records.get_mut(&self.cache_id) {
                        record.paint_range = new_paint;
                        record.bounds_log_range = new_bounds;
                        record.text_paint_range = new_text;
                        record.painted_frame = Some(window.drawn_frames());
                    }
                }
            }
        }
    }
}
