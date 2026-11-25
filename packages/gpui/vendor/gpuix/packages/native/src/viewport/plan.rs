//! Child range planning for Tier 1 (per-child placeholder) and Tier 2
//! (contiguous flex/grid offscreen run collapsing).

use gpui::{px, Style};
use rustc_hash::FxHashSet;

use crate::retained_tree::{RetainedElement, RetainedTree};
use crate::style::StyleDesc;

use super::spacer::{
    flex_column_spacer_style, flex_row_spacer_style, grid_spacer_style, has_negative_margin,
    margins_of,
};
use super::{ActiveScrollClip, CachedBox, ViewportCache};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunCollapseMode {
    None,
    FlexColumn,
    FlexRow,
    Grid { cols: usize },
}

pub(crate) enum ChildPlan {
    Build(u64),
    Placeholder(u64),
    CollapsedRun {
        slot: u64,
        start: usize,
        end: usize,
        style: Style,
        has_focusable: bool,
    },
}

pub(crate) fn classify_run_collapse(
    element: &RetainedElement,
    style: Option<&StyleDesc>,
    overflow_x_only: bool,
) -> RunCollapseMode {
    if overflow_x_only || element.children.len() < 4 || element.content.is_some() {
        return RunCollapseMode::None;
    }
    let Some(s) = style else {
        return RunCollapseMode::FlexColumn;
    };
    let start_justify = matches!(
        s.justify_content.as_deref(),
        None | Some("start" | "flex-start" | "stretch")
    );
    if !start_justify {
        return RunCollapseMode::None;
    }
    match s.display.as_deref() {
        Some("grid") => {
            if s.grid_template_rows.is_some() || s.grid_column_min.is_some() {
                return RunCollapseMode::None;
            }
            if !matches!(
                s.align_content.as_deref(),
                None | Some("start" | "flex-start" | "stretch")
            ) {
                return RunCollapseMode::None;
            }
            let Some(cols) = s.grid_template_columns else {
                return RunCollapseMode::None;
            };
            let cols = cols.round().clamp(1.0, 64.0) as usize;
            RunCollapseMode::Grid { cols }
        }
        Some("flex") => {
            if matches!(s.flex_wrap.as_deref(), Some("wrap" | "wrap-reverse")) {
                return RunCollapseMode::None;
            }
            match s.flex_direction.as_deref() {
                Some("column") => RunCollapseMode::FlexColumn,
                None | Some("row") => RunCollapseMode::FlexRow,
                _ => RunCollapseMode::None,
            }
        }
        None | Some("block") => RunCollapseMode::FlexColumn,
        _ => RunCollapseMode::None,
    }
}

fn is_inflow_collapsible_item(child: &RetainedElement, check_flex_grow: bool) -> bool {
    let Some(s) = child.style.as_deref() else {
        return true;
    };
    if matches!(s.position.as_deref(), Some("absolute" | "fixed")) {
        return false;
    }
    if check_flex_grow && s.flex_grow.is_some_and(|g| g > 0.0) {
        return false;
    }
    !has_negative_margin(margins_of(Some(s)))
}

fn spacer_slot(start: usize, end: usize, total: usize, interior_ordinal: &mut u64) -> u64 {
    if start == 0 {
        0
    } else if end == total {
        1
    } else {
        let slot = 2 + *interior_ordinal;
        *interior_ordinal = interior_ordinal.wrapping_add(1);
        slot
    }
}

pub(crate) fn plan_host_children(
    parent: &RetainedElement,
    parent_style: Option<&StyleDesc>,
    overflow_x_only: bool,
    cache: &ViewportCache,
    clip: &ActiveScrollClip,
    ancestor_own_hash: u64,
    pinned_ancestors: &FxHashSet<u64>,
    tree: &RetainedTree,
) -> Vec<ChildPlan> {
    let children = &parent.children;
    if children.is_empty() {
        return Vec::new();
    }
    let mode = classify_run_collapse(parent, parent_style, overflow_x_only);
    match mode {
        RunCollapseMode::Grid { cols } => plan_grid_children(
            parent,
            cols,
            cache,
            clip,
            ancestor_own_hash,
            pinned_ancestors,
            tree,
        ),
        RunCollapseMode::FlexColumn => plan_flex_children(
            parent,
            true,
            cache,
            clip,
            ancestor_own_hash,
            pinned_ancestors,
            tree,
        ),
        RunCollapseMode::FlexRow => plan_flex_children(
            parent,
            false,
            cache,
            clip,
            ancestor_own_hash,
            pinned_ancestors,
            tree,
        ),
        RunCollapseMode::None => plan_individual_children(
            parent,
            cache,
            clip,
            ancestor_own_hash,
            pinned_ancestors,
            tree,
        ),
    }
}

fn plan_individual_children(
    parent: &RetainedElement,
    cache: &ViewportCache,
    clip: &ActiveScrollClip,
    ancestor_own_hash: u64,
    pinned_ancestors: &FxHashSet<u64>,
    tree: &RetainedTree,
) -> Vec<ChildPlan> {
    let mut plan = Vec::with_capacity(parent.children.len());
    for &cid in &parent.children {
        if let Some(child) = tree.elements.get(&cid) {
            if cache
                .cullable_child(
                    child,
                    parent.own_revision,
                    ancestor_own_hash,
                    clip,
                    pinned_ancestors,
                )
                .is_some()
            {
                plan.push(ChildPlan::Placeholder(cid));
                continue;
            }
        }
        plan.push(ChildPlan::Build(cid));
    }
    plan
}

fn plan_flex_children(
    parent: &RetainedElement,
    vertical: bool,
    cache: &ViewportCache,
    clip: &ActiveScrollClip,
    ancestor_own_hash: u64,
    pinned_ancestors: &FxHashSet<u64>,
    tree: &RetainedTree,
) -> Vec<ChildPlan> {
    let children = &parent.children;
    let total = children.len();
    let mut plan = Vec::new();
    let mut interior_ordinal = 0u64;
    let mut i = 0;

    while i < total {
        let Some(first_el) = tree.elements.get(&children[i]) else {
            plan.push(ChildPlan::Build(children[i]));
            i += 1;
            continue;
        };
        let Some(first_box) = cache.cullable_child(
            first_el,
            parent.own_revision,
            ancestor_own_hash,
            clip,
            pinned_ancestors,
        ) else {
            plan.push(ChildPlan::Build(children[i]));
            i += 1;
            continue;
        };
        if !is_inflow_collapsible_item(first_el, true) {
            plan.push(ChildPlan::Placeholder(children[i]));
            i += 1;
            continue;
        }

        // Extend contiguous run of in-flow offscreen cullable siblings.
        let run_start = i;
        let (mut min_main, mut max_main, mut max_cross) = flex_bounds(first_el, first_box, vertical);
        let mut has_focusable = first_box.contains_focusable;
        i += 1;

        while i < total {
            let Some(el) = tree.elements.get(&children[i]) else {
                break;
            };
            if !is_inflow_collapsible_item(el, true) {
                break;
            }
            let Some(cbox) = cache.cullable_child(
                el,
                parent.own_revision,
                ancestor_own_hash,
                clip,
                pinned_ancestors,
            ) else {
                break;
            };
            let (s_min, s_max, s_cross) = flex_bounds(el, cbox, vertical);
            min_main = min_main.min(s_min);
            max_main = max_main.max(s_max);
            max_cross = max_cross.max(s_cross);
            has_focusable |= cbox.contains_focusable;
            i += 1;
        }

        let run_len = i - run_start;
        let span = max_main - min_main;
        if run_len >= 2 && span > 0.0 {
            let slot = spacer_slot(run_start, i, total, &mut interior_ordinal);
            let style = if vertical {
                flex_column_spacer_style(px(span), px(max_cross))
            } else {
                flex_row_spacer_style(px(span), px(max_cross))
            };
            plan.push(ChildPlan::CollapsedRun {
                slot,
                start: run_start,
                end: i,
                style,
                has_focusable,
            });
        } else {
            for &cid in &children[run_start..i] {
                plan.push(ChildPlan::Placeholder(cid));
            }
        }
    }
    plan
}

fn flex_bounds(el: &RetainedElement, cbox: &CachedBox, vertical: bool) -> (f32, f32, f32) {
    let m = margins_of(el.style.as_deref());
    if vertical {
        let top = f32::from(cbox.content_origin.y) - m.top;
        let bottom = f32::from(cbox.content_origin.y + cbox.size.height) + m.bottom;
        let width = f32::from(cbox.size.width) + m.left + m.right;
        (top, bottom, width)
    } else {
        let left = f32::from(cbox.content_origin.x) - m.left;
        let right = f32::from(cbox.content_origin.x + cbox.size.width) + m.right;
        let height = f32::from(cbox.size.height) + m.top + m.bottom;
        (left, right, height)
    }
}

fn plan_grid_children(
    parent: &RetainedElement,
    cols: usize,
    cache: &ViewportCache,
    clip: &ActiveScrollClip,
    ancestor_own_hash: u64,
    pinned_ancestors: &FxHashSet<u64>,
    tree: &RetainedTree,
) -> Vec<ChildPlan> {
    let children = &parent.children;
    let total = children.len();
    let num_rows = total.div_ceil(cols);
    let mut plan = Vec::new();
    let mut interior_ordinal = 0u64;
    let mut row = 0;

    while row < num_rows {
        let row_start_idx = row * cols;
        if let Some((mut min_top, mut max_bottom, mut has_focusable)) = row_cull_span(
            children,
            row_start_idx,
            (row_start_idx + cols).min(total),
            parent.own_revision,
            ancestor_own_hash,
            cache,
            clip,
            pinned_ancestors,
            tree,
        ) {
            let run_start_row = row;
            row += 1;
            while row < num_rows {
                let rs = row * cols;
                let re = (rs + cols).min(total);
                let Some((rt, rb, rf)) = row_cull_span(
                    children,
                    rs,
                    re,
                    parent.own_revision,
                    ancestor_own_hash,
                    cache,
                    clip,
                    pinned_ancestors,
                    tree,
                ) else {
                    break;
                };
                min_top = min_top.min(rt);
                max_bottom = max_bottom.max(rb);
                has_focusable |= rf;
                row += 1;
            }

            let start_idx = run_start_row * cols;
            let end_idx = (row * cols).min(total);
            let span_h = max_bottom - min_top;
            if row - run_start_row >= 2 && span_h > 0.0 {
                let slot = spacer_slot(start_idx, end_idx, total, &mut interior_ordinal);
                plan.push(ChildPlan::CollapsedRun {
                    slot,
                    start: start_idx,
                    end: end_idx,
                    style: grid_spacer_style(cols, px(span_h)),
                    has_focusable,
                });
                continue;
            }
            for &cid in &children[start_idx..end_idx] {
                plan.push(ChildPlan::Placeholder(cid));
            }
            continue;
        }

        let row_end_idx = (row_start_idx + cols).min(total);
        for &cid in &children[row_start_idx..row_end_idx] {
            if let Some(child) = tree.elements.get(&cid) {
                if cache
                    .cullable_child(
                        child,
                        parent.own_revision,
                        ancestor_own_hash,
                        clip,
                        pinned_ancestors,
                    )
                    .is_some()
                {
                    plan.push(ChildPlan::Placeholder(cid));
                    continue;
                }
            }
            plan.push(ChildPlan::Build(cid));
        }
        row += 1;
    }

    plan
}

#[allow(clippy::too_many_arguments)]
fn row_cull_span(
    children: &[u64],
    start: usize,
    end: usize,
    parent_own_revision: u64,
    ancestor_own_hash: u64,
    cache: &ViewportCache,
    clip: &ActiveScrollClip,
    pinned_ancestors: &FxHashSet<u64>,
    tree: &RetainedTree,
) -> Option<(f32, f32, bool)> {
    let mut min_top = f32::INFINITY;
    let mut max_bottom = f32::NEG_INFINITY;
    let mut has_focusable = false;

    for &cid in &children[start..end] {
        let el = tree.elements.get(&cid)?;
        if !is_inflow_collapsible_item(el, false) {
            return None;
        }
        let cbox = cache.cullable_child(
            el,
            parent_own_revision,
            ancestor_own_hash,
            clip,
            pinned_ancestors,
        )?;
        let m = margins_of(el.style.as_deref());
        let top = f32::from(cbox.content_origin.y) - m.top;
        let bottom = f32::from(cbox.content_origin.y + cbox.size.height) + m.bottom;
        min_top = min_top.min(top);
        max_bottom = max_bottom.max(bottom);
        has_focusable |= cbox.contains_focusable;
    }

    (min_top.is_finite() && max_bottom.is_finite()).then_some((min_top, max_bottom, has_focusable))
}
