use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;

static APPLY_BATCH_COUNT: AtomicU64 = AtomicU64::new(0);
static APPLY_BATCH_NS: AtomicU64 = AtomicU64::new(0);
static NOOP_BATCH_COUNT: AtomicU64 = AtomicU64::new(0);
static LAST_BUILT_ELEMENTS: AtomicU64 = AtomicU64::new(0);
static LAST_REPLAYED_SUBTREES: AtomicU64 = AtomicU64::new(0);
static LAST_REPLAYED_ELEMENTS: AtomicU64 = AtomicU64::new(0);

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
pub struct PerfMetrics {
    pub request_layout_ms: f64,
    pub prepaint_ms: f64,
    pub paint_ms: f64,
    #[cfg_attr(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        napi(js_name = "a11yMs")
    )]
    pub a11y_ms: f64,
    pub scene_finish_ms: f64,
    pub present_ms: f64,
    pub total_draw_ms: f64,
    pub draw_count: f64,
    pub present_count: f64,
    pub apply_batch_count: f64,
    pub apply_batch_ms: f64,
    pub noop_batch_count: f64,
    pub retained_elements: f64,
    pub built_elements: f64,
    pub replayed_subtrees: f64,
    pub replayed_elements: f64,
    pub taffy_writes: f64,
    pub scene_primitives: f64,
    pub backdrop_passes: f64,
    pub backdrop_cache_hits: f64,
}

pub(crate) fn record_apply_batch(duration_ns: u64) {
    APPLY_BATCH_COUNT.fetch_add(1, Ordering::Relaxed);
    APPLY_BATCH_NS.fetch_add(duration_ns, Ordering::Relaxed);
}

pub(crate) fn record_noop_batch() {
    NOOP_BATCH_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn reset_frame_build_stats() {
    LAST_BUILT_ELEMENTS.store(0, Ordering::Relaxed);
    LAST_REPLAYED_SUBTREES.store(0, Ordering::Relaxed);
    LAST_REPLAYED_ELEMENTS.store(0, Ordering::Relaxed);
}

pub(crate) fn add_frame_built_elements(count: u64) {
    LAST_BUILT_ELEMENTS.fetch_add(count, Ordering::Relaxed);
}

pub(crate) fn add_frame_replayed_stats(subtrees: u64, elements: u64) {
    LAST_REPLAYED_SUBTREES.fetch_add(subtrees, Ordering::Relaxed);
    LAST_REPLAYED_ELEMENTS.fetch_add(elements, Ordering::Relaxed);
}

pub(crate) fn snapshot_perf_metrics(
    window: &gpui::Window,
    retained_elements: usize,
) -> PerfMetrics {
    let timings = window.last_draw_timings();
    let replayed_subtrees =
        LAST_REPLAYED_SUBTREES.load(Ordering::Relaxed).max(timings.replayed_views);
    PerfMetrics {
        request_layout_ms: timings.request_layout_ms,
        prepaint_ms: timings.prepaint_ms,
        paint_ms: timings.paint_ms,
        a11y_ms: timings.a11y_ms,
        scene_finish_ms: timings.scene_finish_ms,
        present_ms: timings.present_ms,
        total_draw_ms: timings.total_draw_ms,
        draw_count: timings.draw_count as f64,
        present_count: timings.present_count as f64,
        apply_batch_count: APPLY_BATCH_COUNT.load(Ordering::Relaxed) as f64,
        apply_batch_ms: APPLY_BATCH_NS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
        noop_batch_count: NOOP_BATCH_COUNT.load(Ordering::Relaxed) as f64,
        retained_elements: retained_elements as f64,
        built_elements: LAST_BUILT_ELEMENTS.load(Ordering::Relaxed) as f64,
        replayed_subtrees: replayed_subtrees as f64,
        replayed_elements: LAST_REPLAYED_ELEMENTS.load(Ordering::Relaxed) as f64,
        taffy_writes: timings.taffy_writes as f64,
        scene_primitives: timings.scene_primitives as f64,
        backdrop_passes: timings.backdrop_passes as f64,
        backdrop_cache_hits: timings.backdrop_cache_hits as f64,
    }
}

pub(crate) fn reset_perf_metrics(window: &mut gpui::Window) {
    window.reset_draw_timings();
    APPLY_BATCH_COUNT.store(0, Ordering::Relaxed);
    APPLY_BATCH_NS.store(0, Ordering::Relaxed);
    NOOP_BATCH_COUNT.store(0, Ordering::Relaxed);
    LAST_BUILT_ELEMENTS.store(0, Ordering::Relaxed);
    LAST_REPLAYED_SUBTREES.store(0, Ordering::Relaxed);
    LAST_REPLAYED_ELEMENTS.store(0, Ordering::Relaxed);
}
