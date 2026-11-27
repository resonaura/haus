// todo("windows"): remove
#![cfg_attr(windows, allow(dead_code))]

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    AtlasTextureId, AtlasTile, Background, Bounds, ContentMask, Corners, Edges, Hsla, Pixels,
    Point, Radians, ScaledPixels, ShaderId, Size, bounds_tree::BoundsTree, point,
};
use collections::FxHashMap;
use std::{
    fmt::Debug,
    iter::Peekable,
    ops::{Add, Range, Sub},
    slice,
};

#[allow(non_camel_case_types, unused)]
#[expect(missing_docs)]
pub type PathVertex_ScaledPixels = PathVertex<ScaledPixels>;

#[expect(missing_docs)]
pub type DrawOrder = u32;

/// Names a run of paint operations, so a later frame can find what an element drew and draw it
/// again.
pub type SpanId = u64;

/// Where a named span sits among a scene's paint operations, with the bounds it was given.
struct PaintSpan {
    operations: Range<usize>,
    bounds: Bounds<Pixels>,
}

/// A boolean stored as a `u32` so that GPU-facing structs contain no
/// compiler-inserted padding bytes, which would be undefined behavior to
/// reinterpret as `&[u8]` when writing instance buffers. Guaranteed to be
/// `0` or `1` by construction; shaders read it as a `u32`/`uint`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
#[repr(transparent)]
pub struct PaddedBool32(u32);

impl From<bool> for PaddedBool32 {
    fn from(value: bool) -> Self {
        PaddedBool32(value as u32)
    }
}

#[derive(Clone, Copy, Default)]
struct PrimitiveSnapshot {
    shadows: usize,
    backdrops: usize,
    quads: usize,
    shaders: usize,
    paths: usize,
    underlines: usize,
    monochrome_sprites: usize,
    subpixel_sprites: usize,
    polychrome_sprites: usize,
    surfaces: usize,
}

#[derive(Default)]
#[expect(missing_docs)]
pub struct Scene {
    pub(crate) paint_operations: Vec<PaintOperation>,
    primitive_bounds: BoundsTree<ScaledPixels>,
    layer_stack: Vec<DrawOrder>,
    spans: FxHashMap<SpanId, PaintSpan>,
    span_stack: Vec<(SpanId, usize, Bounds<Pixels>)>,
    pub shadows: Vec<Shadow>,
    pub backdrops: Vec<Backdrop>,
    pub effects: Vec<LayerEffect>,
    effect_stack: Vec<usize>,
    effect_corner_hits: Vec<bool>,
    effect_snapshots: Vec<PrimitiveSnapshot>,
    pub quads: Vec<Quad>,
    pub shaders: Vec<ShaderQuad>,
    pub paths: Vec<Path<ScaledPixels>>,
    pub underlines: Vec<Underline>,
    pub monochrome_sprites: Vec<MonochromeSprite>,
    pub subpixel_sprites: Vec<SubpixelSprite>,
    pub polychrome_sprites: Vec<PolychromeSprite>,
    pub surfaces: Vec<PaintSurface>,
}

#[expect(missing_docs)]
impl Scene {
    pub fn clear(&mut self) {
        self.paint_operations.clear();
        self.primitive_bounds.clear();
        self.layer_stack.clear();
        self.spans.clear();
        self.span_stack.clear();
        self.paths.clear();
        self.shadows.clear();
        self.backdrops.clear();
        self.effects.clear();
        self.effect_stack.clear();
        self.effect_corner_hits.clear();
        self.effect_snapshots.clear();
        self.quads.clear();
        self.shaders.clear();
        self.underlines.clear();
        self.monochrome_sprites.clear();
        self.subpixel_sprites.clear();
        self.polychrome_sprites.clear();
        self.surfaces.clear();
    }

    pub fn primitive_count(&self) -> usize {
        self.shadows.len()
            + self.backdrops.len()
            + self.quads.len()
            + self.shaders.len()
            + self.paths.len()
            + self.underlines.len()
            + self.monochrome_sprites.len()
            + self.subpixel_sprites.len()
            + self.polychrome_sprites.len()
            + self.surfaces.len()
    }

    fn capture_primitive_snapshot(&self) -> PrimitiveSnapshot {
        PrimitiveSnapshot {
            shadows: self.shadows.len(),
            backdrops: self.backdrops.len(),
            quads: self.quads.len(),
            shaders: self.shaders.len(),
            paths: self.paths.len(),
            underlines: self.underlines.len(),
            monochrome_sprites: self.monochrome_sprites.len(),
            subpixel_sprites: self.subpixel_sprites.len(),
            polychrome_sprites: self.polychrome_sprites.len(),
            surfaces: self.surfaces.len(),
        }
    }

    fn activate_corner_effect(&mut self, effect_idx: usize) {
        if self.effect_corner_hits[effect_idx] {
            return;
        }
        self.effect_corner_hits[effect_idx] = true;
        let snapshot = self.effect_snapshots[effect_idx];
        let start = self.primitive_bounds.barrier();
        self.effects[effect_idx].start = start;

        let mut min_order = DrawOrder::MAX;
        for p in &self.shadows[snapshot.shadows..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.backdrops[snapshot.backdrops..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.quads[snapshot.quads..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.shaders[snapshot.shaders..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.paths[snapshot.paths..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.underlines[snapshot.underlines..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.monochrome_sprites[snapshot.monochrome_sprites..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.subpixel_sprites[snapshot.subpixel_sprites..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.polychrome_sprites[snapshot.polychrome_sprites..] {
            min_order = min_order.min(p.order);
        }
        for p in &self.surfaces[snapshot.surfaces..] {
            min_order = min_order.min(p.order);
        }
        for k in (effect_idx + 1)..self.effects.len() {
            if self.effect_corner_hits[k] {
                min_order = min_order.min(self.effects[k].start);
            }
        }

        if min_order == DrawOrder::MAX {
            for k in (effect_idx + 1)..self.effects.len() {
                self.effects[k].start = self.effects[k].start.max(start);
                if self.effects[k].end != DrawOrder::MAX {
                    self.effects[k].end = self.effects[k].start;
                }
            }
            return;
        }

        let shift = (start + 1).saturating_sub(min_order);
        let mut max_order = start;
        if shift > 0 {
            for p in &mut self.shadows[snapshot.shadows..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.backdrops[snapshot.backdrops..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.quads[snapshot.quads..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.shaders[snapshot.shaders..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.paths[snapshot.paths..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.underlines[snapshot.underlines..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.monochrome_sprites[snapshot.monochrome_sprites..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.subpixel_sprites[snapshot.subpixel_sprites..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.polychrome_sprites[snapshot.polychrome_sprites..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
            for p in &mut self.surfaces[snapshot.surfaces..] {
                p.order += shift;
                max_order = max_order.max(p.order);
            }
        }
        for k in (effect_idx + 1)..self.effects.len() {
            if self.effect_corner_hits[k] {
                self.effects[k].start += shift;
                if self.effects[k].end != DrawOrder::MAX {
                    self.effects[k].end += shift;
                    max_order = max_order.max(self.effects[k].end);
                } else {
                    max_order = max_order.max(self.effects[k].start);
                }
            } else {
                self.effects[k].start = self.effects[k].start.max(start);
                if self.effects[k].end != DrawOrder::MAX {
                    self.effects[k].end = self.effects[k].start;
                }
            }
        }
        self.primitive_bounds.raise_floor(max_order);
    }

    pub fn len(&self) -> usize {
        self.paint_operations.len()
    }

    /// Whether this scene contains backdrop blur surfaces or backdrop-sampling custom shaders.
    pub fn has_backdrops(&self) -> bool {
        !self.backdrops.is_empty()
            || self
                .shaders
                .iter()
                .any(|shader| (shader.flags & crate::SHADER_FLAG_SAMPLES_BACKDROP) != 0)
    }

    pub fn push_layer(&mut self, bounds: Bounds<ScaledPixels>) {
        let order = self.primitive_bounds.insert(bounds);
        self.layer_stack.push(order);
        self.paint_operations
            .push(PaintOperation::StartLayer(bounds));
    }

    pub fn pop_layer(&mut self) {
        self.layer_stack.pop();
        self.paint_operations.push(PaintOperation::EndLayer);
    }

    /// Starts a layer that is drawn offscreen, put through the given filter, and composited back.
    pub fn push_filter(
        &mut self,
        source_bounds: Bounds<ScaledPixels>,
        clip_bounds: Bounds<ScaledPixels>,
        transform_origin: Point<ScaledPixels>,
        content_mask: Bounds<ScaledPixels>,
        filter: Filter,
    ) {
        let destination_bounds = filter.transform_bounds(source_bounds, transform_origin);
        let lazy_corner_clip = filter.is_corner_clip_only() && self.layer_stack.is_empty();
        if !filter.is_corner_clip_only() {
            let stack_len = self.effect_stack.len();
            for stack_pos in 0..stack_len {
                let parent_idx = self.effect_stack[stack_pos];
                if !self.effect_corner_hits[parent_idx] {
                    let parent = self.effects[parent_idx];
                    if bounds_hits_corner_zones(
                        destination_bounds.intersect(&content_mask),
                        parent.clip_bounds,
                        parent.filter.clip_radii,
                    ) {
                        self.activate_corner_effect(parent_idx);
                    }
                }
            }
        }
        let start = if lazy_corner_clip {
            self.primitive_bounds.highest()
        } else {
            self.primitive_bounds.barrier()
        };
        let snapshot = self.capture_primitive_snapshot();
        self.effects.push(LayerEffect {
            start,
            end: DrawOrder::MAX,
            source_bounds,
            clip_bounds,
            transform_origin,
            destination_bounds,
            content_mask,
            filter,
            parent: self.effect_stack.last().copied(),
        });
        self.effect_corner_hits.push(!lazy_corner_clip);
        self.effect_snapshots.push(snapshot);
        self.effect_stack.push(self.effects.len() - 1);
        self.paint_operations.push(PaintOperation::StartFilter(
            source_bounds,
            clip_bounds,
            transform_origin,
            content_mask,
            filter,
        ));
    }

    pub fn pop_filter(&mut self) {
        if let Some(index) = self.effect_stack.pop() {
            let prune = self.effects[index].filter.is_corner_clip_only()
                && !self.effect_corner_hits[index];
            if prune {
                if index + 1 == self.effects.len() {
                    self.effects.pop();
                    self.effect_corner_hits.pop();
                    self.effect_snapshots.pop();
                } else {
                    self.effects[index].end = self.effects[index].start;
                }
            } else {
                self.effects[index].end = self.primitive_bounds.barrier();
            }
        }
        self.paint_operations.push(PaintOperation::EndFilter);
    }

    /// Starts a named span. Everything painted until [`Scene::pop_span`] can be found again under
    /// `id`, in this scene and in the next one that replays it.
    pub fn push_span(&mut self, id: SpanId, bounds: Bounds<Pixels>) {
        self.paint_operations
            .push(PaintOperation::StartSpan(id, bounds));
        self.span_stack
            .push((id, self.paint_operations.len(), bounds));
    }

    pub fn pop_span(&mut self) {
        if let Some((id, start, bounds)) = self.span_stack.pop() {
            let operations = start..self.paint_operations.len();
            self.spans.insert(id, PaintSpan { operations, bounds });
        }
        self.paint_operations.push(PaintOperation::EndSpan);
    }

    /// The bounds the span `id` was given, when this scene holds one.
    pub fn span(&self, id: SpanId) -> Option<Bounds<Pixels>> {
        self.spans.get(&id).map(|span| span.bounds)
    }

    /// Paints what `prev_scene` painted in its span `id` again, under the same name, with the
    /// alpha of every colour scaled by `fade`. Spans nested in it lose their names. Returns
    /// whether `prev_scene` held the span.
    pub fn replay_span(&mut self, id: SpanId, prev_scene: &Scene, fade: f32) -> bool {
        let Some(span) = prev_scene.spans.get(&id) else {
            return false;
        };
        self.push_span(id, span.bounds);
        let (mut layers, mut filters) = (0usize, 0usize);
        for operation in &prev_scene.paint_operations[span.operations.clone()] {
            match operation {
                PaintOperation::Primitive(primitive) => {
                    self.insert_primitive(primitive.clone().faded(fade))
                }
                PaintOperation::StartLayer(bounds) => {
                    layers += 1;
                    self.push_layer(*bounds);
                }
                PaintOperation::EndLayer if layers > 0 => {
                    layers -= 1;
                    self.pop_layer();
                }
                PaintOperation::StartFilter(
                    bounds,
                    clip_bounds,
                    transform_origin,
                    content_mask,
                    filter,
                ) => {
                    filters += 1;
                    self.push_filter(
                        *bounds,
                        *clip_bounds,
                        *transform_origin,
                        *content_mask,
                        *filter,
                    );
                }
                PaintOperation::EndFilter if filters > 0 => {
                    filters -= 1;
                    self.pop_filter();
                }
                PaintOperation::EndLayer
                | PaintOperation::EndFilter
                | PaintOperation::StartSpan(..)
                | PaintOperation::EndSpan => {}
            }
        }
        for _ in 0..filters {
            self.pop_filter();
        }
        for _ in 0..layers {
            self.pop_layer();
        }
        self.pop_span();
        true
    }

    /// The draw order of a batch's first primitive.
    pub fn batch_order(&self, batch: &PrimitiveBatch) -> DrawOrder {
        match batch {
            PrimitiveBatch::Shadows(range) => self.shadows[range.start].order,
            PrimitiveBatch::Backdrops(range) => self.backdrops[range.start].order,
            PrimitiveBatch::Quads(range) => self.quads[range.start].order,
            PrimitiveBatch::Shaders { range, .. } => self.shaders[range.start].order,
            PrimitiveBatch::Paths(range) => self.paths[range.start].order,
            PrimitiveBatch::Underlines(range) => self.underlines[range.start].order,
            PrimitiveBatch::MonochromeSprites { range, .. } => {
                self.monochrome_sprites[range.start].order
            }
            PrimitiveBatch::SubpixelSprites { range, .. } => {
                self.subpixel_sprites[range.start].order
            }
            PrimitiveBatch::PolychromeSprites { range, .. } => {
                self.polychrome_sprites[range.start].order
            }
            PrimitiveBatch::Surfaces(range) => self.surfaces[range.start].order,
        }
    }

    /// The innermost layer a primitive drawn at the given order belongs to, if any.
    pub fn filtered(&self, order: DrawOrder) -> Option<usize> {
        let after = self.effects.partition_point(|layer| layer.start <= order);
        (0..after)
            .rev()
            .find(|index| self.effects[*index].end > order)
    }

    /// A layer and everything that encloses it, outermost first.
    pub fn filter_chain(&self, index: usize) -> Vec<usize> {
        let mut chain = vec![index];
        let mut walk = self.effects[index].parent;
        while let Some(parent) = walk {
            if self.effects[parent].end > self.effects[parent].start {
                chain.push(parent);
            }
            walk = self.effects[parent].parent;
        }
        chain.reverse();
        chain
    }

    pub fn insert_primitive(&mut self, primitive: impl Into<Primitive>) {
        let mut primitive = primitive.into();
        let clipped_bounds = primitive
            .bounds()
            .intersect(&primitive.content_mask().bounds);

        if clipped_bounds.is_empty() {
            return;
        }

        if !self.effect_stack.is_empty() {
            let stack_len = self.effect_stack.len();
            for stack_pos in 0..stack_len {
                let effect_idx = self.effect_stack[stack_pos];
                if !self.effect_corner_hits[effect_idx] {
                    let layer = self.effects[effect_idx];
                    if primitive_needs_corner_clip(
                        &primitive,
                        clipped_bounds,
                        layer.clip_bounds,
                        layer.filter.clip_radii,
                        layer.filter.clip_smoothing,
                    ) {
                        self.activate_corner_effect(effect_idx);
                    }
                }
            }
        }

        let order = self
            .layer_stack
            .last()
            .copied()
            .unwrap_or_else(|| self.primitive_bounds.insert(clipped_bounds));
        match &mut primitive {
            Primitive::Shadow(shadow) => {
                shadow.order = order;
                self.shadows.push(*shadow);
            }
            Primitive::Backdrop(backdrop) => {
                backdrop.order = order;
                self.backdrops.push(*backdrop);
            }
            Primitive::Quad(quad) => {
                quad.order = order;
                self.quads.push(*quad);
            }
            Primitive::Shader(shader) => {
                shader.order = order;
                self.shaders.push(*shader);
            }
            Primitive::Path(path) => {
                path.order = order;
                path.id = PathId(self.paths.len());
                self.paths.push(path.clone());
            }
            Primitive::Underline(underline) => {
                underline.order = order;
                self.underlines.push(*underline);
            }
            Primitive::MonochromeSprite(sprite) => {
                sprite.order = order;
                self.monochrome_sprites.push(*sprite);
            }
            Primitive::SubpixelSprite(sprite) => {
                sprite.order = order;
                self.subpixel_sprites.push(*sprite);
            }
            Primitive::PolychromeSprite(sprite) => {
                sprite.order = order;
                self.polychrome_sprites.push(*sprite);
            }
            Primitive::Surface(surface) => {
                surface.order = order;
                self.surfaces.push(surface.clone());
            }
        }
        self.paint_operations
            .push(PaintOperation::Primitive(primitive));
    }

    pub fn replay(&mut self, range: Range<usize>, prev_scene: &Scene) {
        self.paint_operations.reserve(range.len());
        for operation in &prev_scene.paint_operations[range] {
            match operation {
                PaintOperation::Primitive(primitive) => self.insert_primitive(primitive.clone()),
                PaintOperation::StartLayer(bounds) => self.push_layer(*bounds),
                PaintOperation::EndLayer => self.pop_layer(),
                PaintOperation::StartFilter(
                    bounds,
                    clip_bounds,
                    transform_origin,
                    content_mask,
                    filter,
                ) => self.push_filter(
                    *bounds,
                    *clip_bounds,
                    *transform_origin,
                    *content_mask,
                    *filter,
                ),
                PaintOperation::EndFilter => self.pop_filter(),
                PaintOperation::StartSpan(id, bounds) => self.push_span(*id, *bounds),
                PaintOperation::EndSpan => self.pop_span(),
            }
        }
    }

    pub fn finish(&mut self) {
        self.span_stack.clear();
        for index in self.effect_stack.drain(..) {
            log::warn!("scene: a filtered layer was left open");
            self.effects[index].end = self.effects[index].start;
        }
        self.shadows.sort_by_key(|shadow| shadow.order);
        self.backdrops.sort_by_key(|backdrop| backdrop.order);
        self.quads.sort_by_key(|quad| quad.order);
        self.shaders
            .sort_by_key(|shader| (shader.order, shader.shader));
        self.paths.sort_by_key(|path| path.order);
        self.underlines.sort_by_key(|underline| underline.order);
        self.monochrome_sprites
            .sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        self.subpixel_sprites
            .sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        self.polychrome_sprites
            .sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        self.surfaces.sort_by_key(|surface| surface.order);
    }

    pub fn backdrop_underneath_digest_for_backdrops(
        &self,
        start_index: usize,
        source_clip: Option<Bounds<ScaledPixels>>,
        open_effects: &[usize],
        clear_alpha_bits: u32,
        tile_generation: impl Fn(AtlasTextureId, crate::TileId) -> u64,
    ) -> Option<u64> {
        let before_order = self.backdrops.get(start_index)?.order;
        self.backdrop_underneath_digest_inner(
            before_order,
            PrimitiveKind::Backdrop,
            Some(start_index),
            None,
            source_clip,
            open_effects,
            clear_alpha_bits,
            tile_generation,
        )
    }

    pub fn backdrop_underneath_digest_for_shaders(
        &self,
        start_index: usize,
        source_clip: Option<Bounds<ScaledPixels>>,
        open_effects: &[usize],
        clear_alpha_bits: u32,
        tile_generation: impl Fn(AtlasTextureId, crate::TileId) -> u64,
    ) -> Option<u64> {
        let before_order = self.shaders.get(start_index)?.order;
        self.backdrop_underneath_digest_inner(
            before_order,
            PrimitiveKind::Shader,
            None,
            Some(start_index),
            source_clip,
            open_effects,
            clear_alpha_bits,
            tile_generation,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn backdrop_underneath_digest_inner(
        &self,
        before_order: DrawOrder,
        before_kind: PrimitiveKind,
        exact_backdrops_end: Option<usize>,
        exact_shaders_end: Option<usize>,
        source_clip: Option<Bounds<ScaledPixels>>,
        open_effects: &[usize],
        clear_alpha_bits: u32,
        tile_generation: impl Fn(AtlasTextureId, crate::TileId) -> u64,
    ) -> Option<u64> {
        use std::hash::{Hash, Hasher};

        if !crate::incremental_rendering_enabled() {
            return None;
        }

        #[inline]
        fn f_bits(v: f32) -> u32 {
            if v == 0.0 { 0 } else { v.to_bits() }
        }
        #[inline]
        fn hash_f32(h: &mut collections::FxHasher, v: f32) {
            f_bits(v).hash(h);
        }
        #[inline]
        fn hash_point_sp(h: &mut collections::FxHasher, p: Point<ScaledPixels>) {
            hash_f32(h, p.x.0);
            hash_f32(h, p.y.0);
        }
        #[inline]
        fn hash_bounds_sp(h: &mut collections::FxHasher, b: Bounds<ScaledPixels>) {
            hash_point_sp(h, b.origin);
            hash_f32(h, b.size.width.0);
            hash_f32(h, b.size.height.0);
        }
        #[inline]
        fn hash_corners_sp(h: &mut collections::FxHasher, c: Corners<ScaledPixels>) {
            hash_f32(h, c.top_left.0);
            hash_f32(h, c.top_right.0);
            hash_f32(h, c.bottom_right.0);
            hash_f32(h, c.bottom_left.0);
        }
        #[inline]
        fn hash_edges_sp(h: &mut collections::FxHasher, e: Edges<ScaledPixels>) {
            hash_f32(h, e.top.0);
            hash_f32(h, e.right.0);
            hash_f32(h, e.bottom.0);
            hash_f32(h, e.left.0);
        }
        #[inline]
        fn hash_hsla(h: &mut collections::FxHasher, c: Hsla) {
            hash_f32(h, c.h);
            hash_f32(h, c.s);
            hash_f32(h, c.l);
            hash_f32(h, c.a);
        }
        #[inline]
        fn hash_background(h: &mut collections::FxHasher, bg: Background) {
            (bg.tag as u32).hash(h);
            (bg.color_space as u32).hash(h);
            hash_hsla(h, bg.solid);
            hash_f32(h, bg.gradient_angle_or_pattern_height);
            for stop in bg.colors {
                hash_hsla(h, stop.color);
                hash_f32(h, stop.percentage);
            }
        }
        #[inline]
        fn hash_tile(h: &mut collections::FxHasher, tile: AtlasTile, generation: u64) {
            tile.texture_id.hash(h);
            tile.tile_id.hash(h);
            tile.padding.hash(h);
            tile.bounds.origin.x.0.hash(h);
            tile.bounds.origin.y.0.hash(h);
            tile.bounds.size.width.0.hash(h);
            tile.bounds.size.height.0.hash(h);
            generation.hash(h);
        }
        #[inline]
        fn hash_matrix(h: &mut collections::FxHasher, m: TransformationMatrix) {
            hash_f32(h, m.rotation_scale[0][0]);
            hash_f32(h, m.rotation_scale[0][1]);
            hash_f32(h, m.rotation_scale[1][0]);
            hash_f32(h, m.rotation_scale[1][1]);
            hash_f32(h, m.translation[0]);
            hash_f32(h, m.translation[1]);
        }
        #[inline]
        fn hash_filter(h: &mut collections::FxHasher, f: Filter) {
            hash_f32(h, f.blur);
            hash_f32(h, f.fade_top);
            hash_f32(h, f.fade_bottom);
            hash_f32(h, f.fade_left);
            hash_f32(h, f.fade_right);
            hash_f32(h, f.scale_x);
            hash_f32(h, f.scale_y);
            hash_f32(h, f.rotate_rad);
            hash_f32(h, f.skew_x_rad);
            hash_f32(h, f.skew_y_rad);
            hash_point_sp(h, f.translate);
            hash_corners_sp(h, f.clip_radii);
            hash_f32(h, f.clip_smoothing);
        }

        // Expand `effective_clip` across any earlier closed `LayerEffect` whose composited
        // destination touches our capture region and transforms or blurs its offscreen source.
        let mut effective_clip = source_clip;
        if let Some(mut clip) = effective_clip {
            for effect in self.effects.iter().rev() {
                if effect.end <= effect.start + 1 || effect.end > before_order {
                    continue;
                }
                let dst = effect.destination_scissor_bounds(effect.destination_clip());
                if dst.intersects(&clip) && (effect.filter.transforms() || effect.filter.blurs()) {
                    let margin = if effect.filter.blurs() {
                        BlurPasses::for_sigma(effect.filter.blur).source_margin()
                    } else {
                        ScaledPixels(0.0)
                    };
                    clip = clip.union(&effect.source_bounds.dilate(margin));
                }
            }
            effective_clip = Some(clip);
        }

        #[inline]
        fn touches_clip(
            bounds: Bounds<ScaledPixels>,
            mask: Bounds<ScaledPixels>,
            clip: Option<Bounds<ScaledPixels>>,
        ) -> bool {
            let clipped = bounds.intersect(&mask);
            if clipped.is_empty() {
                return false;
            }
            match clip {
                Some(region) => clipped.intersects(&region),
                None => true,
            }
        }

        let end_for_kind = |kind: PrimitiveKind, len: usize, order_at: &dyn Fn(usize) -> DrawOrder| {
            let mut lo = 0usize;
            let mut hi = len;
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                let ord = order_at(mid);
                let before = if kind < before_kind {
                    ord <= before_order
                } else {
                    ord < before_order
                };
                if before {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            lo
        };

        // Live hardware video surfaces (`CVPixelBuffer` / GPU `PaintSurface`) underneath a
        // backdrop must always blur the latest video frame rather than serving a cached texture.
        let surfaces_end =
            end_for_kind(PrimitiveKind::Surface, self.surfaces.len(), &|i| {
                self.surfaces[i].order
            });
        for surface in &self.surfaces[..surfaces_end] {
            if touches_clip(surface.bounds, surface.content_mask.bounds, effective_clip) {
                return None;
            }
        }

        let mut hasher = collections::FxHasher::default();
        0x4841_5553_4244_5250_u64.hash(&mut hasher);
        clear_alpha_bits.hash(&mut hasher);

        // Enclosing open `LayerEffect` stack (`effect.end` is intentionally omitted because
        // foreground primitives drawn after the backdrop inside the same open layer can shift
        // `effect.end` without changing anything drawn before the backdrop).
        open_effects.len().hash(&mut hasher);
        for &effect_idx in open_effects {
            if let Some(effect) = self.effects.get(effect_idx) {
                effect.start.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, effect.source_bounds);
                hash_bounds_sp(&mut hasher, effect.clip_bounds);
                hash_point_sp(&mut hasher, effect.transform_origin);
                hash_bounds_sp(&mut hasher, effect.content_mask);
                hash_filter(&mut hasher, effect.filter);
                effect.parent.hash(&mut hasher);
            }
        }

        // Closed `LayerEffect`s that composited before this batch inside `effective_clip`.
        0x4546_4653_u32.hash(&mut hasher);
        for (idx, effect) in self.effects.iter().enumerate() {
            if effect.end <= effect.start + 1 || effect.end > before_order {
                continue;
            }
            let dst = effect.destination_scissor_bounds(effect.destination_clip());
            let intersects = match effective_clip {
                Some(region) => dst.intersects(&region),
                None => !dst.is_empty(),
            };
            if intersects {
                idx.hash(&mut hasher);
                effect.start.hash(&mut hasher);
                effect.end.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, effect.source_bounds);
                hash_bounds_sp(&mut hasher, effect.clip_bounds);
                hash_point_sp(&mut hasher, effect.transform_origin);
                hash_bounds_sp(&mut hasher, effect.content_mask);
                hash_filter(&mut hasher, effect.filter);
                effect.parent.hash(&mut hasher);
            }
        }

        let shadows_end =
            end_for_kind(PrimitiveKind::Shadow, self.shadows.len(), &|i| {
                self.shadows[i].order
            });
        0x5348_4457_u32.hash(&mut hasher);
        for s in &self.shadows[..shadows_end] {
            if touches_clip(s.bounds, s.content_mask.bounds, effective_clip) {
                s.order.hash(&mut hasher);
                hash_f32(&mut hasher, s.blur_radius.0);
                hash_bounds_sp(&mut hasher, s.bounds);
                hash_corners_sp(&mut hasher, s.corner_radii);
                hash_bounds_sp(&mut hasher, s.content_mask.bounds);
                hash_hsla(&mut hasher, s.color);
                hash_bounds_sp(&mut hasher, s.element_bounds);
                hash_corners_sp(&mut hasher, s.element_corner_radii);
                s.inset.hash(&mut hasher);
                hash_f32(&mut hasher, s.element_corner_smoothing);
            }
        }

        let backdrops_end = exact_backdrops_end.unwrap_or_else(|| {
            end_for_kind(PrimitiveKind::Backdrop, self.backdrops.len(), &|i| {
                self.backdrops[i].order
            })
        });
        0x424B_4450_u32.hash(&mut hasher);
        for b in &self.backdrops[..backdrops_end] {
            if touches_clip(b.bounds, b.content_mask.bounds, effective_clip) {
                b.order.hash(&mut hasher);
                hash_f32(&mut hasher, b.corner_smoothing);
                hash_f32(&mut hasher, b.blur);
                hash_f32(&mut hasher, b.opacity);
                hash_bounds_sp(&mut hasher, b.bounds);
                hash_bounds_sp(&mut hasher, b.content_mask.bounds);
                hash_corners_sp(&mut hasher, b.corner_radii);
            }
        }

        let quads_end =
            end_for_kind(PrimitiveKind::Quad, self.quads.len(), &|i| self.quads[i].order);
        0x5155_4144_u32.hash(&mut hasher);
        for q in &self.quads[..quads_end] {
            if touches_clip(q.bounds, q.content_mask.bounds, effective_clip) {
                q.order.hash(&mut hasher);
                q.border_style.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, q.bounds);
                hash_bounds_sp(&mut hasher, q.content_mask.bounds);
                hash_background(&mut hasher, q.background);
                hash_hsla(&mut hasher, q.border_color);
                hash_corners_sp(&mut hasher, q.corner_radii);
                hash_edges_sp(&mut hasher, q.border_widths);
                hash_f32(&mut hasher, q.corner_smoothing);
            }
        }

        let shaders_end = exact_shaders_end.unwrap_or_else(|| {
            end_for_kind(PrimitiveKind::Shader, self.shaders.len(), &|i| {
                self.shaders[i].order
            })
        });
        0x5348_4452_u32.hash(&mut hasher);
        for s in &self.shaders[..shaders_end] {
            if touches_clip(s.bounds, s.content_mask.bounds, effective_clip) {
                s.order.hash(&mut hasher);
                s.shader.hash(&mut hasher);
                hash_f32(&mut hasher, s.opacity);
                hash_f32(&mut hasher, s.time);
                hash_bounds_sp(&mut hasher, s.bounds);
                hash_bounds_sp(&mut hasher, s.content_mask.bounds);
                hash_corners_sp(&mut hasher, s.corner_radii);
                hash_f32(&mut hasher, s.scale_factor);
                hash_f32(&mut hasher, s.corner_smoothing);
                s.flags.hash(&mut hasher);
                hash_f32(&mut hasher, s.backdrop_blur_radius);
                for p in s.params {
                    hash_f32(&mut hasher, p);
                }
                for rgba in s.colors {
                    for ch in rgba {
                        hash_f32(&mut hasher, ch);
                    }
                }
            }
        }

        let paths_end =
            end_for_kind(PrimitiveKind::Path, self.paths.len(), &|i| self.paths[i].order);
        0x5041_5448_u32.hash(&mut hasher);
        for p in &self.paths[..paths_end] {
            if touches_clip(p.bounds, p.content_mask.bounds, effective_clip) {
                p.order.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, p.bounds);
                hash_bounds_sp(&mut hasher, p.content_mask.bounds);
                hash_background(&mut hasher, p.color);
                p.vertices.len().hash(&mut hasher);
                for v in &p.vertices {
                    hash_point_sp(&mut hasher, v.xy_position);
                    hash_f32(&mut hasher, v.st_position.x);
                    hash_f32(&mut hasher, v.st_position.y);
                }
            }
        }

        let underlines_end = end_for_kind(
            PrimitiveKind::Underline,
            self.underlines.len(),
            &|i| self.underlines[i].order,
        );
        0x554E_444C_u32.hash(&mut hasher);
        for u in &self.underlines[..underlines_end] {
            if touches_clip(u.bounds, u.content_mask.bounds, effective_clip) {
                u.order.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, u.bounds);
                hash_bounds_sp(&mut hasher, u.content_mask.bounds);
                hash_hsla(&mut hasher, u.color);
                hash_f32(&mut hasher, u.thickness.0);
                u.wavy.0.hash(&mut hasher);
            }
        }

        let mono_end = end_for_kind(
            PrimitiveKind::MonochromeSprite,
            self.monochrome_sprites.len(),
            &|i| self.monochrome_sprites[i].order,
        );
        0x4D4F_4E4F_u32.hash(&mut hasher);
        for sp in &self.monochrome_sprites[..mono_end] {
            if touches_clip(sp.bounds, sp.content_mask.bounds, effective_clip) {
                sp.order.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, sp.bounds);
                hash_bounds_sp(&mut hasher, sp.content_mask.bounds);
                hash_hsla(&mut hasher, sp.color);
                let gen_id = tile_generation(sp.tile.texture_id, sp.tile.tile_id);
                hash_tile(&mut hasher, sp.tile, gen_id);
                hash_matrix(&mut hasher, sp.transformation);
            }
        }

        let subpixel_end = end_for_kind(
            PrimitiveKind::SubpixelSprite,
            self.subpixel_sprites.len(),
            &|i| self.subpixel_sprites[i].order,
        );
        0x5355_4250_u32.hash(&mut hasher);
        for sp in &self.subpixel_sprites[..subpixel_end] {
            if touches_clip(sp.bounds, sp.content_mask.bounds, effective_clip) {
                sp.order.hash(&mut hasher);
                hash_bounds_sp(&mut hasher, sp.bounds);
                hash_bounds_sp(&mut hasher, sp.content_mask.bounds);
                hash_hsla(&mut hasher, sp.color);
                let gen_id = tile_generation(sp.tile.texture_id, sp.tile.tile_id);
                hash_tile(&mut hasher, sp.tile, gen_id);
                hash_matrix(&mut hasher, sp.transformation);
            }
        }

        let poly_end = end_for_kind(
            PrimitiveKind::PolychromeSprite,
            self.polychrome_sprites.len(),
            &|i| self.polychrome_sprites[i].order,
        );
        0x504F_4C59_u32.hash(&mut hasher);
        for sp in &self.polychrome_sprites[..poly_end] {
            if touches_clip(sp.bounds, sp.content_mask.bounds, effective_clip) {
                sp.order.hash(&mut hasher);
                sp.nearest_neighbor.0.hash(&mut hasher);
                sp.grayscale.0.hash(&mut hasher);
                hash_f32(&mut hasher, sp.opacity);
                hash_bounds_sp(&mut hasher, sp.bounds);
                hash_bounds_sp(&mut hasher, sp.content_mask.bounds);
                hash_corners_sp(&mut hasher, sp.corner_radii);
                let gen_id = tile_generation(sp.tile.texture_id, sp.tile.tile_id);
                hash_tile(&mut hasher, sp.tile, gen_id);
            }
        }

        Some(hasher.finish())
    }

    #[cfg_attr(
        all(
            any(target_os = "linux", target_os = "freebsd"),
            not(any(feature = "x11", feature = "wayland"))
        ),
        allow(dead_code)
    )]
    pub fn batches(&self) -> impl Iterator<Item = PrimitiveBatch> + '_ {
        BatchIterator {
            layered: {
                let mut edges: Vec<DrawOrder> = self
                    .effects
                    .iter()
                    .filter(|layer| layer.end > layer.start + 1)
                    .flat_map(|layer| [layer.start, layer.end])
                    .collect();
                edges.sort_unstable();
                edges
            },
            shadows_start: 0,
            shadows_iter: self.shadows.iter().peekable(),
            backdrops_start: 0,
            backdrops_iter: self.backdrops.iter().peekable(),
            quads_start: 0,
            quads_iter: self.quads.iter().peekable(),
            shaders_start: 0,
            shaders_iter: self.shaders.iter().peekable(),
            paths_start: 0,
            paths_iter: self.paths.iter().peekable(),
            underlines_start: 0,
            underlines_iter: self.underlines.iter().peekable(),
            monochrome_sprites_start: 0,
            monochrome_sprites_iter: self.monochrome_sprites.iter().peekable(),
            subpixel_sprites_start: 0,
            subpixel_sprites_iter: self.subpixel_sprites.iter().peekable(),
            polychrome_sprites_start: 0,
            polychrome_sprites_iter: self.polychrome_sprites.iter().peekable(),
            surfaces_start: 0,
            surfaces_iter: self.surfaces.iter().peekable(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Default)]
#[cfg_attr(
    all(
        any(target_os = "linux", target_os = "freebsd"),
        not(any(feature = "x11", feature = "wayland"))
    ),
    allow(dead_code)
)]
pub(crate) enum PrimitiveKind {
    Shadow,
    Backdrop,
    #[default]
    Quad,
    Shader,
    Path,
    Underline,
    MonochromeSprite,
    SubpixelSprite,
    PolychromeSprite,
    Surface,
}

pub(crate) enum PaintOperation {
    Primitive(Primitive),
    StartLayer(Bounds<ScaledPixels>),
    EndLayer,
    StartFilter(
        Bounds<ScaledPixels>,
        Bounds<ScaledPixels>,
        Point<ScaledPixels>,
        Bounds<ScaledPixels>,
        Filter,
    ),
    EndFilter,
    StartSpan(SpanId, Bounds<Pixels>),
    EndSpan,
}

/// A run of primitives that is drawn offscreen, put through [`Filter`], and composited back.
#[derive(Clone, Copy, Debug, PartialEq)]
#[expect(missing_docs)]
pub struct LayerEffect {
    /// The order the layer opened at. Everything it contains is drawn between this and `end`.
    pub start: DrawOrder,
    /// The order the layer closed at.
    pub end: DrawOrder,
    /// The area of the untransformed offscreen source, including blur reach.
    pub source_bounds: Bounds<ScaledPixels>,
    /// The element's own clip/fade box in untransformed source coordinates (before blur reach or parent clip).
    pub clip_bounds: Bounds<ScaledPixels>,
    /// The center of the element's original bounds, before adding blur reach.
    pub transform_origin: Point<ScaledPixels>,
    /// The source bounds after applying the layer 2D affine transform and translation.
    pub destination_bounds: Bounds<ScaledPixels>,
    /// The parent content mask that was in force when the layer opened.
    pub content_mask: Bounds<ScaledPixels>,
    pub filter: Filter,
    /// The enclosing layer, if this one is nested.
    pub parent: Option<usize>,
}

impl LayerEffect {
    /// The transformed destination area after clipping to the parent content mask.
    pub fn destination_clip(&self) -> Bounds<ScaledPixels> {
        self.destination_bounds.intersect(&self.content_mask)
    }

    /// The destination span rounded out to whole pixels when a transform made it fractional.
    pub fn destination_scissor_bounds(
        &self,
        destination_span: Bounds<ScaledPixels>,
    ) -> Bounds<ScaledPixels> {
        if !self.filter.transforms() {
            return destination_span;
        }

        Bounds::from_corners(
            point(
                ScaledPixels(destination_span.origin.x.0.floor()),
                ScaledPixels(destination_span.origin.y.0.floor()),
            ),
            point(
                ScaledPixels(destination_span.bottom_right().x.0.ceil()),
                ScaledPixels(destination_span.bottom_right().y.0.ceil()),
            ),
        )
    }

    /// The source area the blur passes need to update.
    pub fn blur_bounds(&self, destination_span: Bounds<ScaledPixels>) -> Bounds<ScaledPixels> {
        if self.filter.transforms() {
            self.source_bounds
        } else {
            destination_span
        }
    }

    /// Whether adjacent sibling layers may share one composite operation.
    pub fn can_merge_with(&self, next: &Self) -> bool {
        self.filter == next.filter
            && self.parent == next.parent
            && !self.filter.fades()
            && !next.filter.fades()
            && !self.filter.clips_corners()
            && !next.filter.clips_corners()
            && !self.filter.transforms()
    }
}

/// What a layer does to its contents on the way back into the frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Filter {
    /// The standard deviation of the blur, in scaled pixels.
    pub blur: f32,
    /// How far the contents fade out at the top edge, in scaled pixels.
    pub fade_top: f32,
    /// How far the contents fade out at the bottom edge, in scaled pixels.
    pub fade_bottom: f32,
    /// How far the contents fade out at the left edge, in scaled pixels.
    pub fade_left: f32,
    /// How far the contents fade out at the right edge, in scaled pixels.
    pub fade_right: f32,
    /// Horizontal compositor scale around the layer's transform origin.
    pub scale_x: f32,
    /// Vertical compositor scale around the layer's transform origin.
    pub scale_y: f32,
    /// Counter-clockwise rotation in radians around the layer's transform origin.
    pub rotate_rad: f32,
    /// Horizontal skew angle in radians around the layer's transform origin.
    pub skew_x_rad: f32,
    /// Vertical skew angle in radians around the layer's transform origin.
    pub skew_y_rad: f32,
    /// Compositor translation in scaled pixels.
    pub translate: Point<ScaledPixels>,
    /// Rounded corner radii for inner-content clipping (e.g. `overflow: hidden` + `border-radius`), in scaled pixels.
    pub clip_radii: Corners<ScaledPixels>,
    /// Corner smoothing (superellipse factor in `[0, 1]`) for `clip_radii`.
    pub clip_smoothing: f32,
}

/// The widest blur, as a standard deviation in scaled pixels, that runs as a gaussian at full
/// resolution.
pub const GAUSSIAN_SIGMA: f32 = 4.;

/// How far a gaussian pass reads to either side, in texels, before its weights stop mattering.
pub const GAUSSIAN_REACH: f32 = 3.;

/// How many times a dual Kawase blur can halve the image.
pub const KAWASE_LEVELS: usize = 6;

const KAWASE_SHALLOWEST: usize = 2;
const KAWASE_STEP: f32 = 0.25;

const KAWASE_SPREAD: [&[f32]; 3] = [
    &[
        0.484, 0.484, 0.484, 0.505, 0.525, 0.651, 0.741, 0.825, 0.896, 0.958, 1.015, 1.077, 1.136,
        1.242, 1.335, 1.423, 1.502,
    ],
    &[
        0.48, 0.48, 0.48, 0.501, 0.522, 0.659, 0.749, 0.831, 0.9, 0.962, 1.02, 1.085, 1.145, 1.251,
        1.343, 1.434, 1.516,
    ],
    &[
        0.479, 0.479, 0.479, 0.5, 0.521, 0.667, 0.756, 0.835, 0.901, 0.962, 1.02, 1.085, 1.148,
        1.253, 1.346, 1.437, 1.52,
    ],
];

/// How a renderer blurs by a given standard deviation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BlurPasses {
    /// Two separable gaussian passes at full resolution, across and then down.
    Gaussian(f32),
    /// A dual Kawase blur.
    Kawase(Kawase),
}

impl BlurPasses {
    /// The source margin needed around a clipped blur, including downsample alignment.
    pub fn source_margin(self) -> ScaledPixels {
        ScaledPixels(match self {
            Self::Gaussian(sigma) => (sigma * GAUSSIAN_REACH).ceil() + 1.,
            Self::Kawase(kawase) => kawase.reach() + (1u32 << kawase.levels) as f32,
        })
    }

    /// The blur that spreads a point as far as a gaussian of standard deviation `sigma`.
    pub fn for_sigma(sigma: f32) -> Self {
        match sigma <= GAUSSIAN_SIGMA {
            true => Self::Gaussian(sigma.max(0.)),
            false => Self::Kawase(Kawase::for_sigma(sigma)),
        }
    }
}

/// The passes of a dual Kawase blur.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Kawase {
    /// How many times the image is halved, at least two.
    pub levels: usize,
    /// How far the taps spread.
    pub offset: f32,
    /// The level the blur ends on, one above the deepest.
    pub settled: usize,
}

impl Kawase {
    /// The passes that spread a point as far as a gaussian of standard deviation `sigma`.
    pub fn for_sigma(sigma: f32) -> Self {
        let sigma = sigma.max(0.);
        let mut levels = KAWASE_SHALLOWEST;
        loop {
            let spread = KAWASE_SPREAD[(levels - KAWASE_SHALLOWEST).min(KAWASE_SPREAD.len() - 1)];
            let scale = (1u32 << levels) as f32;
            let widest = spread[spread.len() - 1] * scale;
            if sigma <= widest || levels == KAWASE_LEVELS {
                let target = sigma / scale;
                let above = spread.partition_point(|&spread| spread < target);
                let step = match above {
                    0 => 0.,
                    above if above == spread.len() => (spread.len() - 1) as f32,
                    above => {
                        let (low, high) = (spread[above - 1], spread[above]);
                        (above - 1) as f32 + (target - low) / (high - low)
                    }
                };
                return Self {
                    levels,
                    offset: step * KAWASE_STEP,
                    settled: levels - 1,
                };
            }
            levels += 1;
        }
    }

    /// How far the passes read past a texel, in scaled pixels of the frame.
    pub fn reach(&self) -> f32 {
        let tap = self.offset * 0.5 + 1.;
        let deepest = (1u32 << self.levels) as f32;
        tap * (deepest * 2. - 1.)
    }
}

impl Default for Filter {
    fn default() -> Self {
        Self {
            blur: 0.0,
            fade_top: 0.0,
            fade_bottom: 0.0,
            fade_left: 0.0,
            fade_right: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotate_rad: 0.0,
            skew_x_rad: 0.0,
            skew_y_rad: 0.0,
            translate: Point::default(),
            clip_radii: Corners::default(),
            clip_smoothing: 0.0,
        }
    }
}

impl Filter {
    /// Whether the layer changes its contents at all.
    pub fn is_noop(&self) -> bool {
        self.blur <= 0. && !self.fades() && !self.transforms() && !self.clips_corners()
    }

    /// Whether the layer has to go through the blur passes.
    pub fn blurs(&self) -> bool {
        self.blur > 0.
    }

    /// Whether the layer is masked on its way back.
    pub fn fades(&self) -> bool {
        self.fade_top > 0. || self.fade_bottom > 0. || self.fade_left > 0. || self.fade_right > 0.
    }

    /// Whether the layer masks its contents to rounded corners.
    pub fn clips_corners(&self) -> bool {
        self.clip_radii.top_left.0 > 0.
            || self.clip_radii.top_right.0 > 0.
            || self.clip_radii.bottom_right.0 > 0.
            || self.clip_radii.bottom_left.0 > 0.
    }

    /// Whether this layer exists solely for rounded-corner clipping (safe to prune if no child hits a corner).
    pub fn is_corner_clip_only(&self) -> bool {
        self.clips_corners() && !self.blurs() && !self.fades() && !self.transforms()
    }

    /// Whether the layer applies a non-identity 2D scale.
    pub fn scales(&self) -> bool {
        self.scale_x != 1.0 || self.scale_y != 1.0
    }

    /// Whether the layer applies rotation or skew.
    pub fn rotates_or_skews(&self) -> bool {
        self.rotate_rad != 0.0 || self.skew_x_rad != 0.0 || self.skew_y_rad != 0.0
    }

    /// Whether the layer is translated while it is composited.
    pub fn translates(&self) -> bool {
        self.translate != Point::default()
    }

    /// Whether the layer is transformed while it is composited.
    pub fn transforms(&self) -> bool {
        self.scales() || self.rotates_or_skews() || self.translates()
    }

    /// Linear 2x2 matrix `R(rotate) * Skew(skew_x, skew_y) * S(scale_x, scale_y)` in row-major order.
    pub fn forward_matrix(&self) -> [[f32; 2]; 2] {
        let (sin_r, cos_r) = self.rotate_rad.sin_cos();
        let tx = if self.skew_x_rad != 0.0 {
            self.skew_x_rad.tan()
        } else {
            0.0
        };
        let ty = if self.skew_y_rad != 0.0 {
            self.skew_y_rad.tan()
        } else {
            0.0
        };
        let s00 = self.scale_x;
        let s01 = self.scale_y * tx;
        let s10 = self.scale_x * ty;
        let s11 = self.scale_y;
        [
            [cos_r * s00 - sin_r * s10, cos_r * s01 - sin_r * s11],
            [sin_r * s00 + cos_r * s10, sin_r * s01 + cos_r * s11],
        ]
    }

    /// Inverse 2x2 matrix for mapping destination coordinates back into source coordinates.
    pub fn inverse_matrix(&self) -> [[f32; 2]; 2] {
        let m = self.forward_matrix();
        let det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
        if det.abs() < 1e-6 || !det.is_finite() {
            return [[0.0, 0.0], [0.0, 0.0]];
        }
        let inv_det = 1.0 / det;
        [
            [m[1][1] * inv_det, -m[0][1] * inv_det],
            [-m[1][0] * inv_det, m[0][0] * inv_det],
        ]
    }

    /// Transforms `p` around `origin` and adds `translate`.
    pub fn transform_point(
        &self,
        origin: Point<ScaledPixels>,
        p: Point<ScaledPixels>,
    ) -> Point<ScaledPixels> {
        let m = self.forward_matrix();
        let dx = p.x.0 - origin.x.0;
        let dy = p.y.0 - origin.y.0;
        point(
            ScaledPixels(origin.x.0 + m[0][0] * dx + m[0][1] * dy + self.translate.x.0),
            ScaledPixels(origin.y.0 + m[1][0] * dx + m[1][1] * dy + self.translate.y.0),
        )
    }

    /// Maps a transformed destination point back to the layer's local source coordinates.
    pub fn inverse_transform_point(
        &self,
        origin: Point<ScaledPixels>,
        p: Point<ScaledPixels>,
    ) -> Point<ScaledPixels> {
        let inv = self.inverse_matrix();
        let dx = p.x.0 - self.translate.x.0 - origin.x.0;
        let dy = p.y.0 - self.translate.y.0 - origin.y.0;
        point(
            ScaledPixels(origin.x.0 + inv[0][0] * dx + inv[0][1] * dy),
            ScaledPixels(origin.y.0 + inv[1][0] * dx + inv[1][1] * dy),
        )
    }

    /// Computes the axis-aligned bounding box enclosing `bounds` after applying the affine transform.
    pub fn transform_bounds(
        &self,
        bounds: Bounds<ScaledPixels>,
        origin: Point<ScaledPixels>,
    ) -> Bounds<ScaledPixels> {
        if !self.transforms() {
            return bounds;
        }
        let p0 = self.transform_point(origin, bounds.origin);
        let p1 = self.transform_point(origin, bounds.top_right());
        let p2 = self.transform_point(origin, bounds.bottom_left());
        let p3 = self.transform_point(origin, bounds.bottom_right());
        let min_x = p0.x.0.min(p1.x.0).min(p2.x.0).min(p3.x.0);
        let min_y = p0.y.0.min(p1.y.0).min(p2.y.0).min(p3.y.0);
        let max_x = p0.x.0.max(p1.x.0).max(p2.x.0).max(p3.x.0);
        let max_y = p0.y.0.max(p1.y.0).max(p2.y.0).max(p3.y.0);
        Bounds::from_corners(
            point(ScaledPixels(min_x), ScaledPixels(min_y)),
            point(ScaledPixels(max_x), ScaledPixels(max_y)),
        )
    }
}

fn bounds_hits_corner_zones(
    prim: Bounds<ScaledPixels>,
    clip: Bounds<ScaledPixels>,
    radii: Corners<ScaledPixels>,
) -> bool {
    if prim.is_empty() || clip.is_empty() {
        return false;
    }
    let c_left = clip.origin.x.0;
    let c_top = clip.origin.y.0;
    let c_right = c_left + clip.size.width.0;
    let c_bottom = c_top + clip.size.height.0;
    let p_left = prim.origin.x.0;
    let p_top = prim.origin.y.0;
    let p_right = p_left + prim.size.width.0;
    let p_bottom = p_top + prim.size.height.0;

    let hit_tl = radii.top_left.0 > 0.0
        && p_left < c_left + radii.top_left.0
        && p_top < c_top + radii.top_left.0;
    let hit_tr = radii.top_right.0 > 0.0
        && p_right > c_right - radii.top_right.0
        && p_top < c_top + radii.top_right.0;
    let hit_br = radii.bottom_right.0 > 0.0
        && p_right > c_right - radii.bottom_right.0
        && p_bottom > c_bottom - radii.bottom_right.0;
    let hit_bl = radii.bottom_left.0 > 0.0
        && p_left < c_left + radii.bottom_left.0
        && p_bottom > c_bottom - radii.bottom_left.0;

    hit_tl || hit_tr || hit_br || hit_bl
}

fn self_rounded_inside_clip(
    prim: Bounds<ScaledPixels>,
    prim_radii: Corners<ScaledPixels>,
    prim_smoothing: f32,
    clip: Bounds<ScaledPixels>,
    clip_radii: Corners<ScaledPixels>,
    clip_smoothing: f32,
) -> bool {
    if prim_smoothing + 0.01 < clip_smoothing {
        return false;
    }
    let c_left = clip.origin.x.0;
    let c_top = clip.origin.y.0;
    let c_right = c_left + clip.size.width.0;
    let c_bottom = c_top + clip.size.height.0;
    let p_left = prim.origin.x.0;
    let p_top = prim.origin.y.0;
    let p_right = p_left + prim.size.width.0;
    let p_bottom = p_top + prim.size.height.0;

    if p_left < c_left - 0.5
        || p_top < c_top - 0.5
        || p_right > c_right + 0.5
        || p_bottom > c_bottom + 0.5
    {
        return false;
    }

    let check = |hit: bool, pr: f32, cr: f32, inset_a: f32, inset_b: f32| {
        if !hit {
            return true;
        }
        pr + inset_a.max(0.0).min(inset_b.max(0.0)) + 0.5 >= cr
    };
    let hit_tl = clip_radii.top_left.0 > 0.0
        && p_left < c_left + clip_radii.top_left.0
        && p_top < c_top + clip_radii.top_left.0;
    let hit_tr = clip_radii.top_right.0 > 0.0
        && p_right > c_right - clip_radii.top_right.0
        && p_top < c_top + clip_radii.top_right.0;
    let hit_br = clip_radii.bottom_right.0 > 0.0
        && p_right > c_right - clip_radii.bottom_right.0
        && p_bottom > c_bottom - clip_radii.bottom_right.0;
    let hit_bl = clip_radii.bottom_left.0 > 0.0
        && p_left < c_left + clip_radii.bottom_left.0
        && p_bottom > c_bottom - clip_radii.bottom_left.0;

    check(
        hit_tl,
        prim_radii.top_left.0,
        clip_radii.top_left.0,
        p_left - c_left,
        p_top - c_top,
    ) && check(
        hit_tr,
        prim_radii.top_right.0,
        clip_radii.top_right.0,
        c_right - p_right,
        p_top - c_top,
    ) && check(
        hit_br,
        prim_radii.bottom_right.0,
        clip_radii.bottom_right.0,
        c_right - p_right,
        c_bottom - p_bottom,
    ) && check(
        hit_bl,
        prim_radii.bottom_left.0,
        clip_radii.bottom_left.0,
        p_left - c_left,
        c_bottom - p_bottom,
    )
}

fn primitive_needs_corner_clip(
    primitive: &Primitive,
    clipped_bounds: Bounds<ScaledPixels>,
    clip_bounds: Bounds<ScaledPixels>,
    clip_radii: Corners<ScaledPixels>,
    clip_smoothing: f32,
) -> bool {
    if !bounds_hits_corner_zones(clipped_bounds, clip_bounds, clip_radii) {
        return false;
    }
    match primitive {
        Primitive::Quad(q) => !self_rounded_inside_clip(
            q.bounds,
            q.corner_radii,
            q.corner_smoothing,
            clip_bounds,
            clip_radii,
            clip_smoothing,
        ),
        Primitive::Shader(s) => !self_rounded_inside_clip(
            s.bounds,
            s.corner_radii,
            s.corner_smoothing,
            clip_bounds,
            clip_radii,
            clip_smoothing,
        ),
        Primitive::Backdrop(b) => !self_rounded_inside_clip(
            b.bounds,
            b.corner_radii,
            b.corner_smoothing,
            clip_bounds,
            clip_radii,
            clip_smoothing,
        ),
        _ => true,
    }
}

#[cfg(test)]
mod layer_filter_tests {
    use super::*;
    use crate::{bounds, size};

    fn rect(x: f32, y: f32, width: f32, height: f32) -> Bounds<ScaledPixels> {
        bounds(
            point(ScaledPixels(x), ScaledPixels(y)),
            size(ScaledPixels(width), ScaledPixels(height)),
        )
    }

    fn origin(x: f32, y: f32) -> Point<ScaledPixels> {
        point(ScaledPixels(x), ScaledPixels(y))
    }

    fn filter(scale: f32) -> Filter {
        Filter {
            scale_x: scale,
            scale_y: scale,
            ..Default::default()
        }
    }

    fn assert_close(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() < 0.001,
            "expected {expected}, got {actual}"
        );
    }

    fn assert_bounds_close(actual: Bounds<ScaledPixels>, expected: Bounds<ScaledPixels>) {
        assert_close(actual.origin.x.0, expected.origin.x.0);
        assert_close(actual.origin.y.0, expected.origin.y.0);
        assert_close(actual.size.width.0, expected.size.width.0);
        assert_close(actual.size.height.0, expected.size.height.0);
    }

    #[test]
    fn filter_scale_participates_in_noop_detection() {
        assert!(Filter::default().is_noop());
        assert!(filter(1.0).is_noop());
        assert!(!filter(0.99).is_noop());

        let translated = Filter {
            translate: origin(0.25, -0.75),
            ..Default::default()
        };
        assert!(!translated.is_noop());
        assert!(translated.transforms());
    }

    #[test]
    fn fractional_translation_moves_only_the_destination() {
        let source = rect(10.0, 20.0, 100.0, 40.0);
        let mut scene = Scene::default();
        scene.push_filter(
            source,
            source,
            origin(60.0, 40.0),
            rect(0.0, 0.0, 200.0, 100.0),
            Filter {
                translate: origin(0.25, -0.75),
                ..Default::default()
            },
        );
        scene.pop_filter();

        assert_eq!(scene.effects[0].source_bounds, source);
        assert_bounds_close(
            scene.effects[0].destination_bounds,
            rect(10.25, 19.25, 100.0, 40.0),
        );
    }

    #[test]
    fn center_based_scaling_keeps_the_origin_fixed() {
        let source = rect(10.0, 20.0, 100.0, 40.0);
        let transform_origin = origin(60.0, 40.0);
        let destination = filter(0.99).transform_bounds(source, transform_origin);

        assert_bounds_close(destination, rect(10.5, 20.2, 99.0, 39.6));
        assert_eq!(destination.center(), transform_origin);
    }

    #[test]
    fn affine_2d_transform_round_trips_and_expands_rotated_bounds() {
        let f = Filter {
            scale_x: 1.5,
            scale_y: 0.8,
            rotate_rad: std::f32::consts::FRAC_PI_2,
            skew_x_rad: 0.15,
            translate: origin(12.0, -8.0),
            ..Default::default()
        };
        let orig = origin(50.0, 50.0);
        let p = origin(80.0, 35.0);
        let dst = f.transform_point(orig, p);
        let back = f.inverse_transform_point(orig, dst);
        assert_close(back.x.0, p.x.0);
        assert_close(back.y.0, p.y.0);

        let rot_bounds = Filter {
            rotate_rad: std::f32::consts::FRAC_PI_2,
            ..Default::default()
        }
        .transform_bounds(rect(0.0, 0.0, 100.0, 40.0), origin(50.0, 20.0));
        assert_bounds_close(rot_bounds, rect(30.0, -30.0, 40.0, 100.0));
    }

    #[test]
    fn layer_effect_separates_source_destination_and_parent_clip() {
        let source = rect(10.0, 20.0, 100.0, 40.0);
        let content_mask = rect(20.0, 10.0, 80.0, 80.0);
        let mut scene = Scene::default();
        scene.push_filter(source, source, origin(60.0, 40.0), content_mask, filter(1.1));
        scene.pop_filter();

        let effect = scene.effects[0];
        assert_eq!(effect.source_bounds, source);
        assert_eq!(effect.transform_origin, origin(60.0, 40.0));
        assert_bounds_close(effect.destination_bounds, rect(5.0, 18.0, 110.0, 44.0));
        assert_bounds_close(effect.destination_clip(), rect(20.0, 18.0, 80.0, 44.0));
        assert_eq!(effect.blur_bounds(effect.destination_clip()), source);

        let fractional_span = rect(20.25, 18.75, 79.5, 43.5);
        assert_eq!(
            effect.destination_scissor_bounds(fractional_span),
            rect(20.0, 18.0, 80.0, 45.0)
        );
    }

    #[test]
    fn scene_replay_restores_scaled_layer_effects() {
        let mut previous = Scene::default();
        let source = rect(10.0, 20.0, 100.0, 40.0);
        previous.push_filter(
            source,
            source,
            origin(60.0, 40.0),
            rect(0.0, 0.0, 120.0, 80.0),
            Filter {
                blur: 3.0,
                fade_top: 2.0,
                scale_x: 0.9973,
                scale_y: 0.9973,
                ..Default::default()
            },
        );
        previous.pop_filter();

        let mut replayed = Scene::default();
        replayed.replay(0..previous.len(), &previous);

        assert_eq!(replayed.effects, previous.effects);
    }

    #[test]
    fn transformed_sibling_layers_cannot_merge() {
        let bounds = rect(0.0, 0.0, 100.0, 50.0);
        let content_mask = rect(0.0, 0.0, 500.0, 500.0);
        let mut scene = Scene::default();
        scene.push_filter(bounds, bounds, origin(50.0, 25.0), content_mask, filter(0.99));
        scene.pop_filter();
        scene.push_filter(bounds, bounds, origin(150.0, 25.0), content_mask, filter(0.99));
        scene.pop_filter();

        assert!(!scene.effects[0].can_merge_with(&scene.effects[1]));

        let mut unscaled = scene.effects;
        unscaled[0].filter.scale_x = 1.0;
        unscaled[0].filter.scale_y = 1.0;
        unscaled[1].filter.scale_x = 1.0;
        unscaled[1].filter.scale_y = 1.0;
        assert!(unscaled[0].can_merge_with(&unscaled[1]));
    }

    #[test]
    fn corner_clip_prunes_when_children_avoid_corners_and_keeps_when_hit() {
        let clip_a = rect(0.0, 0.0, 100.0, 100.0);
        let clip_b = rect(120.0, 0.0, 100.0, 100.0);
        let clip_filter = Filter {
            clip_radii: Corners::all(ScaledPixels(16.0)),
            clip_smoothing: 0.6,
            ..Default::default()
        };
        assert!(!clip_filter.is_noop());
        assert!(clip_filter.is_corner_clip_only());

        // Two non-overlapping cards whose children stay clear of corners:
        // both layers are completely popped and children keep identical draw order (batching preserved!).
        let mut safe_scene = Scene::default();
        safe_scene.push_filter(clip_a, clip_a, origin(50.0, 50.0), clip_a, clip_filter);
        safe_scene.insert_primitive(Quad {
            bounds: rect(24.0, 24.0, 50.0, 50.0),
            content_mask: ContentMask { bounds: clip_a },
            ..Default::default()
        });
        safe_scene.pop_filter();
        safe_scene.push_filter(clip_b, clip_b, origin(170.0, 50.0), clip_b, clip_filter);
        safe_scene.insert_primitive(Quad {
            bounds: rect(144.0, 24.0, 50.0, 50.0),
            content_mask: ContentMask { bounds: clip_b },
            ..Default::default()
        });
        safe_scene.pop_filter();
        assert!(safe_scene.effects.is_empty());
        assert_eq!(safe_scene.quads[0].order, safe_scene.quads[1].order);

        // First child stays centered, second child touches corners ->
        // lazy activation promotes BOTH children inside (start, end) above prior siblings.
        let mut hit_scene = Scene::default();
        hit_scene.insert_primitive(Quad {
            bounds: rect(250.0, 0.0, 40.0, 40.0),
            content_mask: ContentMask {
                bounds: rect(0.0, 0.0, 400.0, 200.0),
            },
            ..Default::default()
        });
        hit_scene.push_filter(clip_a, clip_a, origin(50.0, 50.0), clip_a, clip_filter);
        hit_scene.insert_primitive(Quad {
            bounds: rect(24.0, 24.0, 50.0, 50.0),
            content_mask: ContentMask { bounds: clip_a },
            ..Default::default()
        });
        hit_scene.insert_primitive(Quad {
            bounds: clip_a,
            content_mask: ContentMask { bounds: clip_a },
            ..Default::default()
        });
        hit_scene.pop_filter();
        assert_eq!(hit_scene.effects.len(), 1);
        let eff = hit_scene.effects[0];
        assert!(eff.end > eff.start);
        assert!(hit_scene.quads[0].order < eff.start);
        assert!(hit_scene.quads[1].order > eff.start && hit_scene.quads[1].order < eff.end);
        assert!(hit_scene.quads[2].order > hit_scene.quads[1].order && hit_scene.quads[2].order < eff.end);
    }

    #[test]
    fn backdrop_underneath_digest_tracks_only_overlapping_lower_primitives() {
        crate::set_incremental_rendering_enabled(Some(true));
        let vp_mask = ContentMask {
            bounds: rect(0.0, 0.0, 1000.0, 800.0),
        };
        let modal_clip = rect(200.0, 150.0, 400.0, 300.0);

        let build_scene = |under_color_l: f32, outside_color_l: f32, above_color_l: f32| {
            let mut scene = Scene::default();
            // Lower primitive inside modal_clip
            scene.insert_primitive(Quad {
                bounds: rect(240.0, 180.0, 120.0, 80.0),
                content_mask: vp_mask,
                background: crate::solid_background(Hsla {
                    h: 0.5,
                    s: 0.6,
                    l: under_color_l,
                    a: 1.0,
                }),
                ..Default::default()
            });
            // Lower primitive completely outside modal_clip
            scene.insert_primitive(Quad {
                bounds: rect(20.0, 20.0, 80.0, 80.0),
                content_mask: vp_mask,
                background: crate::solid_background(Hsla {
                    h: 0.2,
                    s: 0.6,
                    l: outside_color_l,
                    a: 1.0,
                }),
                ..Default::default()
            });
            // Modal backdrop
            scene.insert_primitive(Backdrop {
                blur: 24.0,
                opacity: 1.0,
                bounds: modal_clip,
                content_mask: vp_mask,
                ..Default::default()
            });
            // Foreground primitive painted on top of modal backdrop
            scene.insert_primitive(Quad {
                bounds: rect(260.0, 200.0, 160.0, 40.0),
                content_mask: vp_mask,
                background: crate::solid_background(Hsla {
                    h: 0.0,
                    s: 0.0,
                    l: above_color_l,
                    a: 1.0,
                }),
                ..Default::default()
            });
            scene.finish();
            scene
        };

        let base = build_scene(0.3, 0.4, 0.9);
        let d_base = base
            .backdrop_underneath_digest_for_backdrops(0, Some(modal_clip), &[], 0, |_, _| 0)
            .expect("digest enabled");

        // Foreground mutation above the backdrop MUST NOT invalidate the digest.
        let fg_changed = build_scene(0.3, 0.4, 0.1);
        let d_fg = fg_changed
            .backdrop_underneath_digest_for_backdrops(0, Some(modal_clip), &[], 0, |_, _| 0)
            .expect("digest enabled");
        assert_eq!(d_base, d_fg);

        // Background mutation outside `modal_clip` MUST NOT invalidate the digest.
        let outside_changed = build_scene(0.3, 0.85, 0.9);
        let d_outside = outside_changed
            .backdrop_underneath_digest_for_backdrops(0, Some(modal_clip), &[], 0, |_, _| 0)
            .expect("digest enabled");
        assert_eq!(d_base, d_outside);

        // Background mutation inside `modal_clip` MUST immediately invalidate the digest.
        let under_changed = build_scene(0.55, 0.4, 0.9);
        let d_under = under_changed
            .backdrop_underneath_digest_for_backdrops(0, Some(modal_clip), &[], 0, |_, _| 0)
            .expect("digest enabled");
        assert_ne!(d_base, d_under);

        // Disabling incremental rendering returns `None`.
        crate::set_incremental_rendering_enabled(Some(false));
        assert!(
            base.backdrop_underneath_digest_for_backdrops(0, Some(modal_clip), &[], 0, |_, _| 0)
                .is_none()
        );
        crate::set_incremental_rendering_enabled(None);
    }
}

#[derive(Clone)]
#[expect(missing_docs)]
pub enum Primitive {
    Shadow(Shadow),
    Backdrop(Backdrop),
    Quad(Quad),
    Shader(ShaderQuad),
    Path(Path<ScaledPixels>),
    Underline(Underline),
    MonochromeSprite(MonochromeSprite),
    SubpixelSprite(SubpixelSprite),
    PolychromeSprite(PolychromeSprite),
    Surface(PaintSurface),
}

#[expect(missing_docs)]
impl Primitive {
    /// The primitive with the alpha of its colours scaled by `fade`.
    pub fn faded(mut self, fade: f32) -> Self {
        let fade = fade.clamp(0., 1.);
        match &mut self {
            Primitive::Shadow(shadow) => shadow.color = shadow.color.opacity(fade),
            Primitive::Backdrop(backdrop) => backdrop.opacity *= fade,
            Primitive::Quad(quad) => {
                quad.background = quad.background.opacity(fade);
                quad.border_color = quad.border_color.opacity(fade);
            }
            Primitive::Shader(shader) => shader.opacity *= fade,
            Primitive::Path(path) => path.color = path.color.opacity(fade),
            Primitive::Underline(underline) => underline.color = underline.color.opacity(fade),
            Primitive::MonochromeSprite(sprite) => sprite.color = sprite.color.opacity(fade),
            Primitive::SubpixelSprite(sprite) => sprite.color = sprite.color.opacity(fade),
            Primitive::PolychromeSprite(sprite) => sprite.opacity *= fade,
            Primitive::Surface(_) => {}
        }
        self
    }

    pub fn bounds(&self) -> &Bounds<ScaledPixels> {
        match self {
            Primitive::Shadow(shadow) => &shadow.bounds,
            Primitive::Backdrop(backdrop) => &backdrop.bounds,
            Primitive::Quad(quad) => &quad.bounds,
            Primitive::Shader(shader) => &shader.bounds,
            Primitive::Path(path) => &path.bounds,
            Primitive::Underline(underline) => &underline.bounds,
            Primitive::MonochromeSprite(sprite) => &sprite.bounds,
            Primitive::SubpixelSprite(sprite) => &sprite.bounds,
            Primitive::PolychromeSprite(sprite) => &sprite.bounds,
            Primitive::Surface(surface) => &surface.bounds,
        }
    }

    pub fn content_mask(&self) -> &ContentMask<ScaledPixels> {
        match self {
            Primitive::Shadow(shadow) => &shadow.content_mask,
            Primitive::Backdrop(backdrop) => &backdrop.content_mask,
            Primitive::Quad(quad) => &quad.content_mask,
            Primitive::Shader(shader) => &shader.content_mask,
            Primitive::Path(path) => &path.content_mask,
            Primitive::Underline(underline) => &underline.content_mask,
            Primitive::MonochromeSprite(sprite) => &sprite.content_mask,
            Primitive::SubpixelSprite(sprite) => &sprite.content_mask,
            Primitive::PolychromeSprite(sprite) => &sprite.content_mask,
            Primitive::Surface(surface) => &surface.content_mask,
        }
    }
}

#[cfg_attr(
    all(
        any(target_os = "linux", target_os = "freebsd"),
        not(any(feature = "x11", feature = "wayland"))
    ),
    allow(dead_code)
)]
struct BatchIterator<'a> {
    /// Where filtered layers open and close, sorted. A batch never spans one of these.
    layered: Vec<DrawOrder>,
    shadows_start: usize,
    shadows_iter: Peekable<slice::Iter<'a, Shadow>>,
    backdrops_start: usize,
    backdrops_iter: Peekable<slice::Iter<'a, Backdrop>>,
    quads_start: usize,
    quads_iter: Peekable<slice::Iter<'a, Quad>>,
    shaders_start: usize,
    shaders_iter: Peekable<slice::Iter<'a, ShaderQuad>>,
    paths_start: usize,
    paths_iter: Peekable<slice::Iter<'a, Path<ScaledPixels>>>,
    underlines_start: usize,
    underlines_iter: Peekable<slice::Iter<'a, Underline>>,
    monochrome_sprites_start: usize,
    monochrome_sprites_iter: Peekable<slice::Iter<'a, MonochromeSprite>>,
    subpixel_sprites_start: usize,
    subpixel_sprites_iter: Peekable<slice::Iter<'a, SubpixelSprite>>,
    polychrome_sprites_start: usize,
    polychrome_sprites_iter: Peekable<slice::Iter<'a, PolychromeSprite>>,
    surfaces_start: usize,
    surfaces_iter: Peekable<slice::Iter<'a, PaintSurface>>,
}

impl<'a> Iterator for BatchIterator<'a> {
    type Item = PrimitiveBatch;

    fn next(&mut self) -> Option<Self::Item> {
        let mut orders_and_kinds = [
            (
                self.shadows_iter.peek().map(|s| s.order),
                PrimitiveKind::Shadow,
            ),
            (
                self.backdrops_iter.peek().map(|b| b.order),
                PrimitiveKind::Backdrop,
            ),
            (self.quads_iter.peek().map(|q| q.order), PrimitiveKind::Quad),
            (
                self.shaders_iter.peek().map(|s| s.order),
                PrimitiveKind::Shader,
            ),
            (self.paths_iter.peek().map(|q| q.order), PrimitiveKind::Path),
            (
                self.underlines_iter.peek().map(|u| u.order),
                PrimitiveKind::Underline,
            ),
            (
                self.monochrome_sprites_iter.peek().map(|s| s.order),
                PrimitiveKind::MonochromeSprite,
            ),
            (
                self.subpixel_sprites_iter.peek().map(|s| s.order),
                PrimitiveKind::SubpixelSprite,
            ),
            (
                self.polychrome_sprites_iter.peek().map(|s| s.order),
                PrimitiveKind::PolychromeSprite,
            ),
            (
                self.surfaces_iter.peek().map(|s| s.order),
                PrimitiveKind::Surface,
            ),
        ];
        orders_and_kinds.sort_by_key(|(order, kind)| (order.unwrap_or(u32::MAX), *kind));

        let first = orders_and_kinds[0];
        let second = orders_and_kinds[1];
        let (batch_kind, max_order_and_kind) = if first.0.is_some() {
            (first.1, (second.0.unwrap_or(u32::MAX), second.1))
        } else {
            return None;
        };

        let first_order = first.0.unwrap_or_default();
        let edge = self.layered.partition_point(|order| *order <= first_order);
        let limit = self.layered.get(edge).copied().unwrap_or(DrawOrder::MAX);
        let max_order_and_kind = max_order_and_kind.min((limit, PrimitiveKind::Shadow));

        match batch_kind {
            PrimitiveKind::Shadow => {
                let shadows_start = self.shadows_start;
                let mut shadows_end = shadows_start + 1;
                self.shadows_iter.next();
                while self
                    .shadows_iter
                    .next_if(|shadow| (shadow.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    shadows_end += 1;
                }
                self.shadows_start = shadows_end;
                Some(PrimitiveBatch::Shadows(shadows_start..shadows_end))
            }
            PrimitiveKind::Backdrop => {
                let backdrops_start = self.backdrops_start;
                let mut backdrops_end = backdrops_start + 1;
                self.backdrops_iter.next();
                while self
                    .backdrops_iter
                    .next_if(|backdrop| (backdrop.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    backdrops_end += 1;
                }
                self.backdrops_start = backdrops_end;
                Some(PrimitiveBatch::Backdrops(backdrops_start..backdrops_end))
            }
            PrimitiveKind::Quad => {
                let quads_start = self.quads_start;
                let mut quads_end = quads_start + 1;
                self.quads_iter.next();
                while self
                    .quads_iter
                    .next_if(|quad| (quad.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    quads_end += 1;
                }
                self.quads_start = quads_end;
                Some(PrimitiveBatch::Quads(quads_start..quads_end))
            }
            PrimitiveKind::Shader => {
                let first_shader = *self.shaders_iter.peek().unwrap();
                let shader = first_shader.shader;
                let flags = first_shader.flags;
                let blur_bits = first_shader.backdrop_blur_radius.to_bits();
                let shaders_start = self.shaders_start;
                let mut shaders_end = shaders_start + 1;
                self.shaders_iter.next();
                while self
                    .shaders_iter
                    .next_if(|instance| {
                        (instance.order, batch_kind) < max_order_and_kind
                            && instance.shader == shader
                            && instance.flags == flags
                            && instance.backdrop_blur_radius.to_bits() == blur_bits
                    })
                    .is_some()
                {
                    shaders_end += 1;
                }
                self.shaders_start = shaders_end;
                Some(PrimitiveBatch::Shaders {
                    shader,
                    range: shaders_start..shaders_end,
                })
            }
            PrimitiveKind::Path => {
                let paths_start = self.paths_start;
                let mut paths_end = paths_start + 1;
                self.paths_iter.next();
                while self
                    .paths_iter
                    .next_if(|path| (path.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    paths_end += 1;
                }
                self.paths_start = paths_end;
                Some(PrimitiveBatch::Paths(paths_start..paths_end))
            }
            PrimitiveKind::Underline => {
                let underlines_start = self.underlines_start;
                let mut underlines_end = underlines_start + 1;
                self.underlines_iter.next();
                while self
                    .underlines_iter
                    .next_if(|underline| (underline.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    underlines_end += 1;
                }
                self.underlines_start = underlines_end;
                Some(PrimitiveBatch::Underlines(underlines_start..underlines_end))
            }
            PrimitiveKind::MonochromeSprite => {
                let texture_id = self.monochrome_sprites_iter.peek().unwrap().tile.texture_id;
                let sprites_start = self.monochrome_sprites_start;
                let mut sprites_end = sprites_start + 1;
                self.monochrome_sprites_iter.next();
                while self
                    .monochrome_sprites_iter
                    .next_if(|sprite| {
                        (sprite.order, batch_kind) < max_order_and_kind
                            && sprite.tile.texture_id == texture_id
                    })
                    .is_some()
                {
                    sprites_end += 1;
                }
                self.monochrome_sprites_start = sprites_end;
                Some(PrimitiveBatch::MonochromeSprites {
                    texture_id,
                    range: sprites_start..sprites_end,
                })
            }
            PrimitiveKind::SubpixelSprite => {
                let texture_id = self.subpixel_sprites_iter.peek().unwrap().tile.texture_id;
                let sprites_start = self.subpixel_sprites_start;
                let mut sprites_end = sprites_start + 1;
                self.subpixel_sprites_iter.next();
                while self
                    .subpixel_sprites_iter
                    .next_if(|sprite| {
                        (sprite.order, batch_kind) < max_order_and_kind
                            && sprite.tile.texture_id == texture_id
                    })
                    .is_some()
                {
                    sprites_end += 1;
                }
                self.subpixel_sprites_start = sprites_end;
                Some(PrimitiveBatch::SubpixelSprites {
                    texture_id,
                    range: sprites_start..sprites_end,
                })
            }
            PrimitiveKind::PolychromeSprite => {
                let texture_id = self.polychrome_sprites_iter.peek().unwrap().tile.texture_id;
                let sprites_start = self.polychrome_sprites_start;
                let mut sprites_end = sprites_start + 1;
                self.polychrome_sprites_iter.next();
                while self
                    .polychrome_sprites_iter
                    .next_if(|sprite| {
                        (sprite.order, batch_kind) < max_order_and_kind
                            && sprite.tile.texture_id == texture_id
                    })
                    .is_some()
                {
                    sprites_end += 1;
                }
                self.polychrome_sprites_start = sprites_end;
                Some(PrimitiveBatch::PolychromeSprites {
                    texture_id,
                    range: sprites_start..sprites_end,
                })
            }
            PrimitiveKind::Surface => {
                let surfaces_start = self.surfaces_start;
                let mut surfaces_end = surfaces_start + 1;
                self.surfaces_iter.next();
                while self
                    .surfaces_iter
                    .next_if(|surface| (surface.order, batch_kind) < max_order_and_kind)
                    .is_some()
                {
                    surfaces_end += 1;
                }
                self.surfaces_start = surfaces_end;
                Some(PrimitiveBatch::Surfaces(surfaces_start..surfaces_end))
            }
        }
    }
}

#[derive(Debug)]
#[cfg_attr(
    all(
        any(target_os = "linux", target_os = "freebsd"),
        not(any(feature = "x11", feature = "wayland"))
    ),
    allow(dead_code)
)]
#[allow(missing_docs)]
pub enum PrimitiveBatch {
    Shadows(Range<usize>),
    Backdrops(Range<usize>),
    Quads(Range<usize>),
    /// Instances of one custom shader.
    Shaders {
        shader: ShaderId,
        range: Range<usize>,
    },
    Paths(Range<usize>),
    Underlines(Range<usize>),
    MonochromeSprites {
        texture_id: AtlasTextureId,
        range: Range<usize>,
    },
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    SubpixelSprites {
        texture_id: AtlasTextureId,
        range: Range<usize>,
    },
    PolychromeSprites {
        texture_id: AtlasTextureId,
        range: Range<usize>,
    },
    Surfaces(Range<usize>),
}

impl PrimitiveBatch {
    #[expect(missing_docs)]
    pub fn label(&self) -> String {
        match self {
            Self::Shadows(range) => format!("shadows ({})", range.len()),
            Self::Backdrops(range) => format!("backdrops ({})", range.len()),
            Self::Quads(range) => format!("quads ({})", range.len()),
            Self::Shaders { shader, range } => {
                format!("shader {} ({})", shader.0, range.len())
            }
            Self::Paths(range) => format!("paths ({})", range.len()),
            Self::Underlines(range) => format!("underlines ({})", range.len()),
            Self::MonochromeSprites { texture_id, range } => {
                format!(
                    "monochrome sprites ({}) on atlas {}",
                    range.len(),
                    texture_id.index
                )
            }
            Self::SubpixelSprites { texture_id, range } => {
                format!(
                    "subpixel sprites ({}) on atlas {}",
                    range.len(),
                    texture_id.index
                )
            }
            Self::PolychromeSprites { texture_id, range } => {
                format!(
                    "polychrome sprites ({}) on atlas {}",
                    range.len(),
                    texture_id.index
                )
            }
            Self::Surfaces(range) => format!("surfaces ({})", range.len()),
        }
    }
}

#[derive(Default, Debug, Copy, Clone)]
#[repr(C)]
#[expect(missing_docs)]
pub struct Backdrop {
    pub order: DrawOrder,
    /// How far the corners are smoothed from circular arcs towards a squircle, from 0 to 1.
    pub corner_smoothing: f32,
    /// The standard deviation of the blur, in scaled pixels.
    pub blur: f32,
    /// How much of the blurred backdrop shows through.
    pub opacity: f32,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
}

impl From<Backdrop> for Primitive {
    fn from(backdrop: Backdrop) -> Self {
        Primitive::Backdrop(backdrop)
    }
}

#[derive(Default, Debug, Copy, Clone)]
#[repr(C)]
#[expect(missing_docs)]
pub struct Quad {
    pub order: DrawOrder,
    pub border_style: BorderStyle,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub background: Background,
    pub border_color: Hsla,
    pub corner_radii: Corners<ScaledPixels>,
    pub border_widths: Edges<ScaledPixels>,
    /// How far the corners are smoothed from circular arcs towards a squircle, from 0 to 1.
    pub corner_smoothing: f32,
    pub pad: u32, // align to 8 bytes
}

impl From<Quad> for Primitive {
    fn from(quad: Quad) -> Self {
        Primitive::Quad(quad)
    }
}

/// One instance of a custom shader, drawn over a rounded rectangle. Its layout matches
/// `GpuiShaderInstance` in `prelude.wgsl`.
#[derive(Debug, Copy, Clone)]
#[repr(C)]
pub struct ShaderQuad {
    /// Where the instance falls among the frame's primitives.
    pub order: DrawOrder,
    /// The shader that colours it.
    pub shader: ShaderId,
    /// The element opacity it is faded by.
    pub opacity: f32,
    /// The time the app painted it with, in seconds.
    pub time: f32,
    /// Its bounds in device pixels.
    pub bounds: Bounds<ScaledPixels>,
    /// The area it is clipped to.
    pub content_mask: ContentMask<ScaledPixels>,
    /// The radii of its corners in device pixels.
    pub corner_radii: Corners<ScaledPixels>,
    /// Device pixels per logical pixel.
    pub scale_factor: f32,
    /// Continuous corner smoothing metadata (`0.0..=1.0`).
    pub corner_smoothing: f32,
    /// Shader behaviour flags (`SHADER_FLAG_SAMPLES_BACKDROP`, `SHADER_FLAG_CUSTOM_SHAPE_ALPHA`).
    pub flags: u32,
    /// Optional blur standard deviation applied to the captured backdrop in device pixels.
    pub backdrop_blur_radius: f32,
    /// The parameters the app painted it with.
    pub params: [f32; crate::SHADER_PARAM_COUNT],
    /// The colours the app painted it with, as straight alpha sRGB.
    pub colors: [[f32; 4]; crate::SHADER_COLOR_COUNT],
}

impl From<ShaderQuad> for Primitive {
    fn from(shader: ShaderQuad) -> Self {
        Primitive::Shader(shader)
    }
}

#[derive(Debug, Copy, Clone)]
#[repr(C)]
#[expect(missing_docs)]
pub struct Underline {
    pub order: DrawOrder,
    pub pad: u32, // align to 8 bytes
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub thickness: ScaledPixels,
    pub wavy: PaddedBool32,
}

impl From<Underline> for Primitive {
    fn from(underline: Underline) -> Self {
        Primitive::Underline(underline)
    }
}

#[derive(Debug, Copy, Clone)]
#[repr(C)]
#[expect(missing_docs)]
pub struct Shadow {
    pub order: DrawOrder,
    pub blur_radius: ScaledPixels,
    pub bounds: Bounds<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub element_bounds: Bounds<ScaledPixels>,
    pub element_corner_radii: Corners<ScaledPixels>,
    /// 0 = drop shadow (rendered outside the element), 1 = inset shadow (rendered inside).
    pub inset: u32,
    /// The corner smoothing of the element's own outline, which clips the shadow.
    pub element_corner_smoothing: f32,
}

impl From<Shadow> for Primitive {
    fn from(shadow: Shadow) -> Self {
        Primitive::Shadow(shadow)
    }
}

/// The style of a border.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[repr(C)]
pub enum BorderStyle {
    /// A solid border.
    #[default]
    Solid = 0,
    /// A dashed border.
    Dashed = 1,
}

/// A data type representing a 2 dimensional transformation that can be applied to an element.
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(C)]
pub struct TransformationMatrix {
    /// 2x2 matrix containing rotation and scale,
    /// stored row-major
    pub rotation_scale: [[f32; 2]; 2],
    /// translation vector
    pub translation: [f32; 2],
}

impl Eq for TransformationMatrix {}

impl TransformationMatrix {
    /// The unit matrix, has no effect.
    pub fn unit() -> Self {
        Self {
            rotation_scale: [[1.0, 0.0], [0.0, 1.0]],
            translation: [0.0, 0.0],
        }
    }

    /// Move the origin by a given point
    pub fn translate(mut self, point: Point<ScaledPixels>) -> Self {
        self.compose(Self {
            rotation_scale: [[1.0, 0.0], [0.0, 1.0]],
            translation: [point.x.0, point.y.0],
        })
    }

    /// Clockwise rotation in radians around the origin
    pub fn rotate(self, angle: Radians) -> Self {
        self.compose(Self {
            rotation_scale: [
                [angle.0.cos(), -angle.0.sin()],
                [angle.0.sin(), angle.0.cos()],
            ],
            translation: [0.0, 0.0],
        })
    }

    /// Scale around the origin
    pub fn scale(self, size: Size<f32>) -> Self {
        self.compose(Self {
            rotation_scale: [[size.width, 0.0], [0.0, size.height]],
            translation: [0.0, 0.0],
        })
    }

    /// Perform matrix multiplication with another transformation
    /// to produce a new transformation that is the result of
    /// applying both transformations: first, `other`, then `self`.
    #[inline]
    pub fn compose(self, other: TransformationMatrix) -> TransformationMatrix {
        if other == Self::unit() {
            return self;
        }
        // Perform matrix multiplication
        TransformationMatrix {
            rotation_scale: [
                [
                    self.rotation_scale[0][0] * other.rotation_scale[0][0]
                        + self.rotation_scale[0][1] * other.rotation_scale[1][0],
                    self.rotation_scale[0][0] * other.rotation_scale[0][1]
                        + self.rotation_scale[0][1] * other.rotation_scale[1][1],
                ],
                [
                    self.rotation_scale[1][0] * other.rotation_scale[0][0]
                        + self.rotation_scale[1][1] * other.rotation_scale[1][0],
                    self.rotation_scale[1][0] * other.rotation_scale[0][1]
                        + self.rotation_scale[1][1] * other.rotation_scale[1][1],
                ],
            ],
            translation: [
                self.translation[0]
                    + self.rotation_scale[0][0] * other.translation[0]
                    + self.rotation_scale[0][1] * other.translation[1],
                self.translation[1]
                    + self.rotation_scale[1][0] * other.translation[0]
                    + self.rotation_scale[1][1] * other.translation[1],
            ],
        }
    }

    /// Apply transformation to a point, mainly useful for debugging
    pub fn apply(&self, point: Point<Pixels>) -> Point<Pixels> {
        let input = [point.x.0, point.y.0];
        let mut output = self.translation;
        for (i, output_cell) in output.iter_mut().enumerate() {
            for (k, input_cell) in input.iter().enumerate() {
                *output_cell += self.rotation_scale[i][k] * *input_cell;
            }
        }
        Point::new(output[0].into(), output[1].into())
    }
}

impl Default for TransformationMatrix {
    fn default() -> Self {
        Self::unit()
    }
}

#[derive(Copy, Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct MonochromeSprite {
    pub order: DrawOrder,
    pub pad: u32,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub tile: AtlasTile,
    pub transformation: TransformationMatrix,
}

impl From<MonochromeSprite> for Primitive {
    fn from(sprite: MonochromeSprite) -> Self {
        Primitive::MonochromeSprite(sprite)
    }
}

#[derive(Copy, Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct SubpixelSprite {
    pub order: DrawOrder,
    pub pad: u32, // align to 8 bytes
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub color: Hsla,
    pub tile: AtlasTile,
    pub transformation: TransformationMatrix,
}

impl From<SubpixelSprite> for Primitive {
    fn from(sprite: SubpixelSprite) -> Self {
        Primitive::SubpixelSprite(sprite)
    }
}

#[derive(Copy, Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct PolychromeSprite {
    pub order: DrawOrder,
    pub nearest_neighbor: PaddedBool32,
    pub grayscale: PaddedBool32,
    pub opacity: f32,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    pub corner_radii: Corners<ScaledPixels>,
    pub tile: AtlasTile,
}

impl From<PolychromeSprite> for Primitive {
    fn from(sprite: PolychromeSprite) -> Self {
        Primitive::PolychromeSprite(sprite)
    }
}

#[derive(Clone)]
#[allow(missing_docs)]
pub struct PaintSurface {
    pub order: DrawOrder,
    pub bounds: Bounds<ScaledPixels>,
    pub content_mask: ContentMask<ScaledPixels>,
    #[cfg(target_os = "macos")]
    pub image_buffer: core_video::pixel_buffer::CVPixelBuffer,
    /// Type-erased GPU texture (`Arc<wgpu::Texture>`). Ported from gpui-ce
    /// ([#39](https://github.com/gpui-ce/gpui-ce/commit/6d043b22e477)).
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub texture: std::sync::Arc<dyn std::any::Any + Send + Sync>,
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub texture_size: Size<crate::DevicePixels>,
}

impl std::fmt::Debug for PaintSurface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut debug = f.debug_struct("PaintSurface");
        debug
            .field("order", &self.order)
            .field("bounds", &self.bounds)
            .field("content_mask", &self.content_mask);
        #[cfg(target_os = "macos")]
        debug.field("image_buffer", &self.image_buffer);
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        debug.field("texture_size", &self.texture_size);
        debug.finish_non_exhaustive()
    }
}

impl From<PaintSurface> for Primitive {
    fn from(surface: PaintSurface) -> Self {
        Primitive::Surface(surface)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
#[expect(missing_docs)]
pub struct PathId(pub usize);

/// A line made up of a series of vertices and control points.
#[derive(Clone, Debug)]
#[expect(missing_docs)]
pub struct Path<P: Clone + Debug + Default + PartialEq> {
    pub id: PathId,
    pub order: DrawOrder,
    pub bounds: Bounds<P>,
    pub content_mask: ContentMask<P>,
    pub vertices: Vec<PathVertex<P>>,
    pub color: Background,
    start: Point<P>,
    current: Point<P>,
    contour_count: usize,
}

impl Path<Pixels> {
    /// Create a new path with the given starting point.
    pub fn new(start: Point<Pixels>) -> Self {
        Self {
            id: PathId(0),
            order: DrawOrder::default(),
            vertices: Vec::new(),
            start,
            current: start,
            bounds: Bounds {
                origin: start,
                size: Default::default(),
            },
            content_mask: Default::default(),
            color: Default::default(),
            contour_count: 0,
        }
    }

    /// Scale this path by the given factor.
    pub fn scale(&self, factor: f32) -> Path<ScaledPixels> {
        Path {
            id: self.id,
            order: self.order,
            bounds: self.bounds.scale(factor),
            content_mask: self.content_mask.scale(factor),
            vertices: self
                .vertices
                .iter()
                .map(|vertex| vertex.scale(factor))
                .collect(),
            start: self.start.map(|start| start.scale(factor)),
            current: self.current.scale(factor),
            contour_count: self.contour_count,
            color: self.color,
        }
    }

    /// Move the start, current point to the given point.
    pub fn move_to(&mut self, to: Point<Pixels>) {
        self.contour_count += 1;
        self.start = to;
        self.current = to;
    }

    /// Draw a straight line from the current point to the given point.
    pub fn line_to(&mut self, to: Point<Pixels>) {
        self.contour_count += 1;
        if self.contour_count > 1 {
            self.push_triangle(
                (self.start, self.current, to),
                (point(0., 1.), point(0., 1.), point(0., 1.)),
            );
        }
        self.current = to;
    }

    /// Draw a curve from the current point to the given point, using the given control point.
    pub fn curve_to(&mut self, to: Point<Pixels>, ctrl: Point<Pixels>) {
        self.contour_count += 1;
        if self.contour_count > 1 {
            self.push_triangle(
                (self.start, self.current, to),
                (point(0., 1.), point(0., 1.), point(0., 1.)),
            );
        }

        self.push_triangle(
            (self.current, ctrl, to),
            (point(0., 0.), point(0.5, 0.), point(1., 1.)),
        );
        self.current = to;
    }

    /// Push a triangle to the Path.
    pub fn push_triangle(
        &mut self,
        xy: (Point<Pixels>, Point<Pixels>, Point<Pixels>),
        st: (Point<f32>, Point<f32>, Point<f32>),
    ) {
        self.bounds = self
            .bounds
            .union(&Bounds {
                origin: xy.0,
                size: Default::default(),
            })
            .union(&Bounds {
                origin: xy.1,
                size: Default::default(),
            })
            .union(&Bounds {
                origin: xy.2,
                size: Default::default(),
            });

        self.vertices.push(PathVertex {
            xy_position: xy.0,
            st_position: st.0,
            content_mask: Default::default(),
        });
        self.vertices.push(PathVertex {
            xy_position: xy.1,
            st_position: st.1,
            content_mask: Default::default(),
        });
        self.vertices.push(PathVertex {
            xy_position: xy.2,
            st_position: st.2,
            content_mask: Default::default(),
        });
    }
}

impl<T> Path<T>
where
    T: Clone + Debug + Default + PartialEq + PartialOrd + Add<T, Output = T> + Sub<Output = T>,
{
    #[allow(unused)]
    #[expect(missing_docs)]
    pub fn clipped_bounds(&self) -> Bounds<T> {
        self.bounds.intersect(&self.content_mask.bounds)
    }
}

impl From<Path<ScaledPixels>> for Primitive {
    fn from(path: Path<ScaledPixels>) -> Self {
        Primitive::Path(path)
    }
}

#[derive(Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct PathVertex<P: Clone + Debug + Default + PartialEq> {
    pub xy_position: Point<P>,
    pub st_position: Point<f32>,
    pub content_mask: ContentMask<P>,
}

#[expect(missing_docs)]
impl PathVertex<Pixels> {
    pub fn scale(&self, factor: f32) -> PathVertex<ScaledPixels> {
        PathVertex {
            xy_position: self.xy_position.scale(factor),
            st_position: self.st_position,
            content_mask: self.content_mask.scale(factor),
        }
    }
}
