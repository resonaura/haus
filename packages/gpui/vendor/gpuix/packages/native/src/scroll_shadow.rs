use crate::style::ScrollShadowDesc;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ScrollShadowEdges {
    pub top: bool,
    pub bottom: bool,
    pub left: bool,
    pub right: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ScrollEdgeOpacities {
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
}

pub(crate) fn resolve_edges(
    edges: Option<&[String]>,
    has_x: bool,
    has_y: bool,
) -> ScrollShadowEdges {
    let Some(list) = edges else {
        return ScrollShadowEdges {
            top: has_y,
            bottom: has_y,
            left: has_x,
            right: has_x,
        };
    };
    let mut resolved = ScrollShadowEdges::default();
    for edge in list {
        match edge.as_str() {
            "top" => resolved.top = true,
            "bottom" => resolved.bottom = true,
            "left" => resolved.left = true,
            "right" => resolved.right = true,
            _ => {}
        }
    }
    resolved
}

pub(crate) fn compute_edge_opacities(
    offset: gpui::Point<gpui::Pixels>,
    max_offset: gpui::Point<gpui::Pixels>,
    ramp_px: f32,
    max_opacity: f32,
    edges: ScrollShadowEdges,
) -> ScrollEdgeOpacities {
    let max_x = f32::from(max_offset.x).max(0.0);
    let max_y = f32::from(max_offset.y).max(0.0);
    let scrolled_x = (-f32::from(offset.x)).clamp(0.0, max_x);
    let scrolled_y = (-f32::from(offset.y)).clamp(0.0, max_y);
    let ramp = ramp_px.max(1.0);
    let peak = max_opacity.clamp(0.0, 1.0);

    ScrollEdgeOpacities {
        top: if edges.top && max_y > 0.5 {
            (scrolled_y / ramp).clamp(0.0, 1.0) * peak
        } else {
            0.0
        },
        bottom: if edges.bottom && max_y > 0.5 {
            ((max_y - scrolled_y) / ramp).clamp(0.0, 1.0) * peak
        } else {
            0.0
        },
        left: if edges.left && max_x > 0.5 {
            (scrolled_x / ramp).clamp(0.0, 1.0) * peak
        } else {
            0.0
        },
        right: if edges.right && max_x > 0.5 {
            ((max_x - scrolled_x) / ramp).clamp(0.0, 1.0) * peak
        } else {
            0.0
        },
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedScrollShadow {
    pub enabled: bool,
    pub is_fade: bool,
    pub size: f32,
    pub opacity: f32,
    pub color: gpui::Rgba,
    pub edges: ScrollShadowEdges,
}

impl ResolvedScrollShadow {
    pub(crate) fn from_desc(desc: Option<&ScrollShadowDesc>, has_x: bool, has_y: bool) -> Self {
        let enabled = desc.and_then(|d| d.enabled).unwrap_or(desc.is_some());
        let is_fade = desc.and_then(|d| d.mode.as_deref()) == Some("fade");
        let size = desc.and_then(|d| d.size).unwrap_or(20.0).max(1.0) as f32;
        let opacity = desc
            .and_then(|d| d.opacity)
            .unwrap_or(0.32)
            .clamp(0.0, 1.0) as f32;
        let color = desc
            .and_then(|d| d.color.as_deref())
            .and_then(crate::color::parse_color_rgba)
            .unwrap_or(gpui::Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            });
        let edges = resolve_edges(
            desc.and_then(|d| d.edges.as_deref()),
            has_x,
            has_y,
        );
        Self {
            enabled,
            is_fade,
            size,
            opacity,
            color,
            edges,
        }
    }
}

pub(crate) fn apply_scroll_fade_mask<E: gpui::Styled>(
    mut el: E,
    handle: &gpui::ScrollHandle,
    spec: ResolvedScrollShadow,
) -> E {
    if !spec.enabled || !spec.is_fade {
        return el;
    }
    let opacities = compute_edge_opacities(
        handle.offset(),
        handle.max_offset(),
        spec.size,
        1.0,
        spec.edges,
    );
    let top = spec.size * opacities.top;
    let bottom = spec.size * opacities.bottom;
    let left = spec.size * opacities.left;
    let right = spec.size * opacities.right;
    if top > 0.5 || bottom > 0.5 {
        el = el.fade_edges(gpui::px(top), gpui::px(bottom));
    }
    if left > 0.5 || right > 0.5 {
        el = el.fade_sides(gpui::px(left), gpui::px(right));
    }
    el
}

pub(crate) fn paint_scroll_shadows(
    window: &mut gpui::Window,
    origin: gpui::Point<gpui::Pixels>,
    size: gpui::Size<gpui::Pixels>,
    spec: ResolvedScrollShadow,
    opacities: ScrollEdgeOpacities,
) {
    if !spec.enabled || spec.is_fade {
        return;
    }
    let width = f32::from(size.width);
    let height = f32::from(size.height);
    if width <= 0.5 || height <= 0.5 {
        return;
    }

    let paint_edge = |window: &mut gpui::Window,
                      bounds: gpui::Bounds<gpui::Pixels>,
                      angle: f32,
                      alpha_scale: f32| {
        if alpha_scale <= 0.002 {
            return;
        }
        let mut edge_color = spec.color;
        edge_color.a *= alpha_scale;
        let mut clear_color = spec.color;
        clear_color.a = 0.0;
        window.paint_quad(gpui::fill(
            bounds,
            gpui::linear_gradient(
                angle,
                gpui::linear_color_stop(edge_color, 0.0),
                gpui::linear_color_stop(clear_color, 1.0),
            ),
        ));
    };

    let vert_h = spec.size.min(height * 0.5);
    let horiz_w = spec.size.min(width * 0.5);

    if vert_h > 0.5 {
        paint_edge(
            window,
            gpui::Bounds::new(origin, gpui::size(size.width, gpui::px(vert_h))),
            180.0,
            opacities.top,
        );
        paint_edge(
            window,
            gpui::Bounds::new(
                gpui::point(origin.x, origin.y + gpui::px(height - vert_h)),
                gpui::size(size.width, gpui::px(vert_h)),
            ),
            0.0,
            opacities.bottom,
        );
    }

    if horiz_w > 0.5 {
        paint_edge(
            window,
            gpui::Bounds::new(origin, gpui::size(gpui::px(horiz_w), size.height)),
            90.0,
            opacities.left,
        );
        paint_edge(
            window,
            gpui::Bounds::new(
                gpui::point(origin.x + gpui::px(width - horiz_w), origin.y),
                gpui::size(gpui::px(horiz_w), size.height),
            ),
            270.0,
            opacities.right,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_scrollable_container_has_zero_shadows() {
        let op = compute_edge_opacities(
            gpui::point(gpui::px(0.0), gpui::px(0.0)),
            gpui::point(gpui::px(0.0), gpui::px(0.0)),
            24.0,
            0.4,
            ScrollShadowEdges {
                top: true,
                bottom: true,
                left: false,
                right: false,
            },
        );
        assert_eq!(op, ScrollEdgeOpacities::default());
    }

    #[test]
    fn vertical_shadows_interpolate_at_top_mid_and_bottom() {
        let edges = ScrollShadowEdges {
            top: true,
            bottom: true,
            left: false,
            right: false,
        };
        let max = gpui::point(gpui::px(0.0), gpui::px(200.0));

        let at_top = compute_edge_opacities(gpui::Point::default(), max, 20.0, 0.5, edges);
        assert_eq!(at_top.top, 0.0);
        assert!((at_top.bottom - 0.5).abs() < 0.001);

        let mid = compute_edge_opacities(gpui::point(gpui::px(0.0), gpui::px(-10.0)), max, 20.0, 0.5, edges);
        assert!((mid.top - 0.25).abs() < 0.001);
        assert!((mid.bottom - 0.5).abs() < 0.001);

        let near_bottom = compute_edge_opacities(gpui::point(gpui::px(0.0), gpui::px(-190.0)), max, 20.0, 0.5, edges);
        assert!((near_bottom.top - 0.5).abs() < 0.001);
        assert!((near_bottom.bottom - 0.25).abs() < 0.001);

        let at_bottom = compute_edge_opacities(gpui::point(gpui::px(0.0), gpui::px(-200.0)), max, 20.0, 0.5, edges);
        assert!((at_bottom.top - 0.5).abs() < 0.001);
        assert_eq!(at_bottom.bottom, 0.0);
    }
}
