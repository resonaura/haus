//! Fine-grained dirty flags and style property classification for `RetainedTree`.

use std::ops::{BitOr, BitOrAssign};

use crate::style::StyleDesc;

/// Compact bitmask classifying what aspects of rendering a mutation affects.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DirtyFlags(u16);

impl DirtyFlags {
    pub const NONE: Self = Self(0);
    /// Non-visual listener registration changes (`click`, `mouseDown`, etc.).
    pub const HIT_TEST: Self = Self(1 << 0);
    /// Pure compositor properties (`opacity`, `transform`, `transform_origin`).
    pub const COMPOSITE: Self = Self(1 << 1);
    /// Paint-only properties (`background`, `color`, `border_color`, `box_shadow`, `glow`, etc.).
    pub const PAINT: Self = Self(1 << 2);
    /// Backdrop-sampling or filter-layer properties (`backdrop_blur`, `liquid_glass`, `blur`, `mask`).
    pub const BACKDROP: Self = Self(1 << 3);
    /// Geometry, sizing, flex/grid, spacing, typography metrics, or overflow changes.
    pub const LAYOUT: Self = Self(1 << 4);
    /// Tree topology or text content changes (`create`, `destroy`, `append`, `insert`, `setText`).
    pub const STRUCTURE: Self = Self(1 << 5);

    pub const VISUAL: Self =
        Self(Self::COMPOSITE.0 | Self::PAINT.0 | Self::BACKDROP.0 | Self::LAYOUT.0 | Self::STRUCTURE.0);

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        (self.0 & other.0) != 0
    }

    #[inline]
    pub const fn affects_layout(self) -> bool {
        self.intersects(Self(Self::LAYOUT.0 | Self::STRUCTURE.0))
    }

    #[inline]
    pub const fn affects_paint(self) -> bool {
        self.intersects(Self::VISUAL)
    }
}

impl BitOr for DirtyFlags {
    type Output = Self;

    #[inline]
    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

impl BitOrAssign for DirtyFlags {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

fn layout_fields_differ(a: &StyleDesc, b: &StyleDesc) -> bool {
    a.display != b.display
        || a.flex_direction != b.flex_direction
        || a.flex_wrap != b.flex_wrap
        || a.flex_grow != b.flex_grow
        || a.flex_shrink != b.flex_shrink
        || a.flex_basis != b.flex_basis
        || a.align_items != b.align_items
        || a.align_self != b.align_self
        || a.align_content != b.align_content
        || a.justify_content != b.justify_content
        || a.gap != b.gap
        || a.row_gap != b.row_gap
        || a.column_gap != b.column_gap
        || a.grid_template_columns != b.grid_template_columns
        || a.grid_template_rows != b.grid_template_rows
        || a.grid_column_min != b.grid_column_min
        || a.grid_row_min != b.grid_row_min
        || a.width != b.width
        || a.height != b.height
        || a.min_width != b.min_width
        || a.min_height != b.min_height
        || a.max_width != b.max_width
        || a.max_height != b.max_height
        || a.padding != b.padding
        || a.padding_top != b.padding_top
        || a.padding_right != b.padding_right
        || a.padding_bottom != b.padding_bottom
        || a.padding_left != b.padding_left
        || a.margin != b.margin
        || a.margin_top != b.margin_top
        || a.margin_right != b.margin_right
        || a.margin_bottom != b.margin_bottom
        || a.margin_left != b.margin_left
        || a.position != b.position
        || a.top != b.top
        || a.right != b.right
        || a.bottom != b.bottom
        || a.left != b.left
        || a.border_width != b.border_width
        || a.border_top_width != b.border_top_width
        || a.border_right_width != b.border_right_width
        || a.border_bottom_width != b.border_bottom_width
        || a.border_left_width != b.border_left_width
        || a.aspect_ratio != b.aspect_ratio
        || a.font_size != b.font_size
        || a.font_family != b.font_family
        || a.font_weight != b.font_weight
        || a.text_align != b.text_align
        || a.line_height != b.line_height
        || a.white_space != b.white_space
        || a.text_overflow != b.text_overflow
        || a.line_clamp != b.line_clamp
        || a.overflow != b.overflow
        || a.overflow_x != b.overflow_x
        || a.overflow_y != b.overflow_y
}

fn backdrop_fields_differ(a: &StyleDesc, b: &StyleDesc) -> bool {
    a.backdrop_blur != b.backdrop_blur
        || a.liquid_glass != b.liquid_glass
        || a.blur != b.blur
        || a.mask != b.mask
        || a.scroll_shadow != b.scroll_shadow
        || a.shader != b.shader
}

fn composite_fields_differ(a: &StyleDesc, b: &StyleDesc) -> bool {
    a.opacity != b.opacity
        || a.transform != b.transform
        || a.transform_origin != b.transform_origin
        || a.motion_bind != b.motion_bind
        || a.scroll_bind != b.scroll_bind
}

fn hit_test_fields_differ(a: &StyleDesc, b: &StyleDesc) -> bool {
    a.pointer_events != b.pointer_events
        || a.overscroll_behavior != b.overscroll_behavior
        || a.overscroll_behavior_x != b.overscroll_behavior_x
        || a.overscroll_behavior_y != b.overscroll_behavior_y
        || a.scroll_policy != b.scroll_policy
        || a.scroll_id != b.scroll_id
}

/// Computes the exact set of [`DirtyFlags`] separating `old` and `new` styles.
pub fn diff_style_flags(old: Option<&StyleDesc>, new: &StyleDesc) -> DirtyFlags {
    let default_style = StyleDesc::default();
    let prev = old.unwrap_or(&default_style);
    let mut flags = DirtyFlags::NONE;
    if layout_fields_differ(prev, new) {
        flags |= DirtyFlags::LAYOUT | DirtyFlags::PAINT;
    }
    if backdrop_fields_differ(prev, new) {
        flags |= DirtyFlags::BACKDROP | DirtyFlags::PAINT;
    }
    if composite_fields_differ(prev, new) {
        flags |= DirtyFlags::COMPOSITE;
    }
    if hit_test_fields_differ(prev, new) {
        flags |= DirtyFlags::HIT_TEST;
    }
    if prev.visibility != new.visibility
        || prev.background != new.background
        || prev.background_color != new.background_color
        || prev.color != new.color
        || prev.border_color != new.border_color
        || prev.border_radius != new.border_radius
        || prev.border_top_left_radius != new.border_top_left_radius
        || prev.border_top_right_radius != new.border_top_right_radius
        || prev.border_bottom_left_radius != new.border_bottom_left_radius
        || prev.border_bottom_right_radius != new.border_bottom_right_radius
        || prev.corner_smoothing != new.corner_smoothing
        || prev.box_shadow != new.box_shadow
        || prev.glow != new.glow
        || prev.border_style != new.border_style
        || prev.outline_width != new.outline_width
        || prev.outline_color != new.outline_color
        || prev.outline_offset != new.outline_offset
        || prev.text_decoration != new.text_decoration
        || prev.scrollbar_color != new.scrollbar_color
        || prev.scrollbar_width != new.scrollbar_width
        || prev.cursor != new.cursor
        || prev.user_select != new.user_select
        || prev.selection_color != new.selection_color
        || prev.hover != new.hover
        || prev.active != new.active
        || prev.focus_visible != new.focus_visible
        || prev.keyboard_focus_dim != new.keyboard_focus_dim
    {
        flags |= DirtyFlags::PAINT;
    }
    flags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_only_change_marks_paint_without_layout() {
        let a = StyleDesc {
            width: Some(crate::style::DimensionValue::Pixels(120.0)),
            background_color: Some("#111111".to_owned()),
            ..Default::default()
        };
        let b = StyleDesc {
            width: Some(crate::style::DimensionValue::Pixels(120.0)),
            background_color: Some("#222222".to_owned()),
            ..Default::default()
        };
        let flags = diff_style_flags(Some(&a), &b);
        assert!(flags.intersects(DirtyFlags::PAINT));
        assert!(!flags.affects_layout());
    }

    #[test]
    fn opacity_and_transform_mark_composite_without_layout() {
        let a = StyleDesc {
            opacity: Some(1.0),
            ..Default::default()
        };
        let b = StyleDesc {
            opacity: Some(0.5),
            ..Default::default()
        };
        let flags = diff_style_flags(Some(&a), &b);
        assert_eq!(flags, DirtyFlags::COMPOSITE);
        assert!(!flags.affects_layout());
    }

    #[test]
    fn width_change_marks_layout() {
        let a = StyleDesc {
            width: Some(crate::style::DimensionValue::Pixels(100.0)),
            ..Default::default()
        };
        let b = StyleDesc {
            width: Some(crate::style::DimensionValue::Pixels(140.0)),
            ..Default::default()
        };
        let flags = diff_style_flags(Some(&a), &b);
        assert!(flags.affects_layout());
    }
}
