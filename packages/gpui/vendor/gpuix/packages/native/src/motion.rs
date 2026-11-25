//! Native motion tracks (tweens, physics springs, keyframes, loops) resolved
//! during GPUI rendering outside React.

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use web_time::Instant;

use crate::style::{DimensionValue, StyleDesc, TransformDesc};

/// Interpolated scalar snapshot for a single animation frame.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionStyle {
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub opacity: Option<f64>,
    pub top: Option<f64>,
    pub right: Option<f64>,
    pub bottom: Option<f64>,
    pub left: Option<f64>,
    pub border_radius: Option<f64>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub scale: Option<f64>,
    pub scale_x: Option<f64>,
    pub scale_y: Option<f64>,
    pub rotate: Option<f64>,
    pub skew_x: Option<f64>,
    pub skew_y: Option<f64>,
    pub blur: Option<f64>,
    pub backdrop_blur: Option<f64>,
}

/// Apply one numeric property value to `StyleDesc` (shared by motion tracks,
/// imperative `motionBind`, and `scrollBind`).
pub(crate) fn apply_scalar_property(style: &mut StyleDesc, property: &str, value: f64) {
    if !value.is_finite() {
        return;
    }
    match property {
        "width" => style.width = Some(DimensionValue::Pixels(value.max(0.0))),
        "height" => style.height = Some(DimensionValue::Pixels(value.max(0.0))),
        "opacity" => style.opacity = Some(value.clamp(0.0, 1.0)),
        "top" => style.top = Some(value),
        "right" => style.right = Some(value),
        "bottom" => style.bottom = Some(value),
        "left" => style.left = Some(value),
        "borderRadius" => style.border_radius = Some(value.max(0.0)),
        "blur" => style.blur = Some(value.max(0.0)),
        "backdropBlur" => style.backdrop_blur = Some(value.max(0.0)),
        "x" | "translateX" => {
            style.transform.get_or_insert_with(Default::default).translate_x = Some(value);
        }
        "y" | "translateY" => {
            style.transform.get_or_insert_with(Default::default).translate_y = Some(value);
        }
        "scale" => {
            style.transform.get_or_insert_with(Default::default).scale = Some(value);
        }
        "scaleX" => {
            style.transform.get_or_insert_with(Default::default).scale_x = Some(value);
        }
        "scaleY" => {
            style.transform.get_or_insert_with(Default::default).scale_y = Some(value);
        }
        "rotate" => {
            style.transform.get_or_insert_with(Default::default).rotate = Some(value);
        }
        "skewX" => {
            style.transform.get_or_insert_with(Default::default).skew_x = Some(value);
        }
        "skewY" => {
            style.transform.get_or_insert_with(Default::default).skew_y = Some(value);
        }
        _ => {}
    }
}

impl MotionStyle {
    fn get(self, key: MotionProp) -> Option<f64> {
        match key {
            MotionProp::Width => self.width,
            MotionProp::Height => self.height,
            MotionProp::Opacity => self.opacity,
            MotionProp::Top => self.top,
            MotionProp::Right => self.right,
            MotionProp::Bottom => self.bottom,
            MotionProp::Left => self.left,
            MotionProp::BorderRadius => self.border_radius,
            MotionProp::X => self.x,
            MotionProp::Y => self.y,
            MotionProp::Scale => self.scale,
            MotionProp::ScaleX => self.scale_x,
            MotionProp::ScaleY => self.scale_y,
            MotionProp::Rotate => self.rotate,
            MotionProp::SkewX => self.skew_x,
            MotionProp::SkewY => self.skew_y,
            MotionProp::Blur => self.blur,
            MotionProp::BackdropBlur => self.backdrop_blur,
        }
    }

    fn set(&mut self, key: MotionProp, value: Option<f64>) {
        match key {
            MotionProp::Width => self.width = value,
            MotionProp::Height => self.height = value,
            MotionProp::Opacity => self.opacity = value,
            MotionProp::Top => self.top = value,
            MotionProp::Right => self.right = value,
            MotionProp::Bottom => self.bottom = value,
            MotionProp::Left => self.left = value,
            MotionProp::BorderRadius => self.border_radius = value,
            MotionProp::X => self.x = value,
            MotionProp::Y => self.y = value,
            MotionProp::Scale => self.scale = value,
            MotionProp::ScaleX => self.scale_x = value,
            MotionProp::ScaleY => self.scale_y = value,
            MotionProp::Rotate => self.rotate = value,
            MotionProp::SkewX => self.skew_x = value,
            MotionProp::SkewY => self.skew_y = value,
            MotionProp::Blur => self.blur = value,
            MotionProp::BackdropBlur => self.backdrop_blur = value,
        }
    }

    pub(crate) fn apply_to(self, style: &mut StyleDesc) {
        if let Some(value) = self.width {
            style.width = Some(DimensionValue::Pixels(value.max(0.0)));
        }
        if let Some(value) = self.height {
            style.height = Some(DimensionValue::Pixels(value.max(0.0)));
        }
        if let Some(value) = self.opacity {
            style.opacity = Some(value.clamp(0.0, 1.0));
        }
        if let Some(value) = self.top {
            style.top = Some(value);
        }
        if let Some(value) = self.right {
            style.right = Some(value);
        }
        if let Some(value) = self.bottom {
            style.bottom = Some(value);
        }
        if let Some(value) = self.left {
            style.left = Some(value);
        }
        if let Some(value) = self.border_radius {
            style.border_radius = Some(value.max(0.0));
        }
        if let Some(value) = self.blur {
            style.blur = Some(value.max(0.0));
        }
        if let Some(value) = self.backdrop_blur {
            style.backdrop_blur = Some(value.max(0.0));
        }
        if self.x.is_some()
            || self.y.is_some()
            || self.scale.is_some()
            || self.scale_x.is_some()
            || self.scale_y.is_some()
            || self.rotate.is_some()
            || self.skew_x.is_some()
            || self.skew_y.is_some()
        {
            let transform = style.transform.get_or_insert_with(TransformDesc::default);
            if let Some(v) = self.x {
                transform.translate_x = Some(v);
            }
            if let Some(v) = self.y {
                transform.translate_y = Some(v);
            }
            if let Some(v) = self.scale {
                transform.scale = Some(v);
            }
            if let Some(v) = self.scale_x {
                transform.scale_x = Some(v);
            }
            if let Some(v) = self.scale_y {
                transform.scale_y = Some(v);
            }
            if let Some(v) = self.rotate {
                transform.rotate = Some(v);
            }
            if let Some(v) = self.skew_x {
                transform.skew_x = Some(v);
            }
            if let Some(v) = self.skew_y {
                transform.skew_y = Some(v);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum MotionProp {
    Width,
    Height,
    Opacity,
    Top,
    Right,
    Bottom,
    Left,
    BorderRadius,
    X,
    Y,
    Scale,
    ScaleX,
    ScaleY,
    Rotate,
    SkewX,
    SkewY,
    Blur,
    BackdropBlur,
}

const ALL_MOTION_PROPS: [MotionProp; 18] = [
    MotionProp::Width,
    MotionProp::Height,
    MotionProp::Opacity,
    MotionProp::Top,
    MotionProp::Right,
    MotionProp::Bottom,
    MotionProp::Left,
    MotionProp::BorderRadius,
    MotionProp::X,
    MotionProp::Y,
    MotionProp::Scale,
    MotionProp::ScaleX,
    MotionProp::ScaleY,
    MotionProp::Rotate,
    MotionProp::SkewX,
    MotionProp::SkewY,
    MotionProp::Blur,
    MotionProp::BackdropBlur,
];

impl MotionProp {
    fn name(self) -> &'static str {
        match self {
            Self::Width => "width",
            Self::Height => "height",
            Self::Opacity => "opacity",
            Self::Top => "top",
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Left => "left",
            Self::BorderRadius => "borderRadius",
            Self::X => "x",
            Self::Y => "y",
            Self::Scale => "scale",
            Self::ScaleX => "scaleX",
            Self::ScaleY => "scaleY",
            Self::Rotate => "rotate",
            Self::SkewX => "skewX",
            Self::SkewY => "skewY",
            Self::Blur => "blur",
            Self::BackdropBlur => "backdropBlur",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub(crate) enum MotionTargetValue {
    Single(f64),
    Keyframes(Vec<Option<f64>>),
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionTargetStyle {
    width: Option<MotionTargetValue>,
    height: Option<MotionTargetValue>,
    opacity: Option<MotionTargetValue>,
    top: Option<MotionTargetValue>,
    right: Option<MotionTargetValue>,
    bottom: Option<MotionTargetValue>,
    left: Option<MotionTargetValue>,
    border_radius: Option<MotionTargetValue>,
    x: Option<MotionTargetValue>,
    y: Option<MotionTargetValue>,
    scale: Option<MotionTargetValue>,
    scale_x: Option<MotionTargetValue>,
    scale_y: Option<MotionTargetValue>,
    rotate: Option<MotionTargetValue>,
    skew_x: Option<MotionTargetValue>,
    skew_y: Option<MotionTargetValue>,
    blur: Option<MotionTargetValue>,
    backdrop_blur: Option<MotionTargetValue>,
}

impl MotionTargetStyle {
    fn get(&self, prop: MotionProp) -> Option<&MotionTargetValue> {
        match prop {
            MotionProp::Width => self.width.as_ref(),
            MotionProp::Height => self.height.as_ref(),
            MotionProp::Opacity => self.opacity.as_ref(),
            MotionProp::Top => self.top.as_ref(),
            MotionProp::Right => self.right.as_ref(),
            MotionProp::Bottom => self.bottom.as_ref(),
            MotionProp::Left => self.left.as_ref(),
            MotionProp::BorderRadius => self.border_radius.as_ref(),
            MotionProp::X => self.x.as_ref(),
            MotionProp::Y => self.y.as_ref(),
            MotionProp::Scale => self.scale.as_ref(),
            MotionProp::ScaleX => self.scale_x.as_ref(),
            MotionProp::ScaleY => self.scale_y.as_ref(),
            MotionProp::Rotate => self.rotate.as_ref(),
            MotionProp::SkewX => self.skew_x.as_ref(),
            MotionProp::SkewY => self.skew_y.as_ref(),
            MotionProp::Blur => self.blur.as_ref(),
            MotionProp::BackdropBlur => self.backdrop_blur.as_ref(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionInitial {
    Disabled(bool),
    Style(MotionStyle),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub(crate) enum MotionEase {
    Name(String),
    CubicBezier([f64; 4]),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub(crate) enum RepeatSpec {
    Count(i64),
    Label(String),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum RepeatBehavior {
    Loop,
    Reverse,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpringConfig {
    pub stiffness: f64,
    pub damping: f64,
    pub mass: f64,
    pub initial_velocity: f64,
    pub rest_delta: f64,
    pub rest_speed: f64,
}

impl Default for SpringConfig {
    fn default() -> Self {
        Self {
            stiffness: 300.0,
            damping: 26.0,
            mass: 1.0,
            initial_velocity: 0.0,
            rest_delta: 0.01,
            rest_speed: 0.01,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionTransition {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub duration: Option<f64>,
    #[serde(default)]
    pub delay: f64,
    pub ease: Option<MotionEase>,
    pub times: Option<Vec<f64>>,
    pub stiffness: Option<f64>,
    pub damping: Option<f64>,
    pub mass: Option<f64>,
    pub velocity: Option<f64>,
    pub bounce: Option<f64>,
    pub rest_delta: Option<f64>,
    pub rest_speed: Option<f64>,
    pub repeat: Option<RepeatSpec>,
    pub repeat_type: Option<String>,
    #[serde(default)]
    pub repeat_delay: f64,
}

impl MotionTransition {
    fn resolved_ease(&self) -> MotionEase {
        self.ease
            .clone()
            .unwrap_or_else(|| MotionEase::Name("easeOut".to_string()))
    }

    fn is_spring(&self) -> bool {
        match self.kind.as_deref() {
            Some("spring") => true,
            Some("tween") => false,
            _ => {
                self.stiffness.is_some()
                    || self.damping.is_some()
                    || self.mass.is_some()
                    || self.bounce.is_some()
                    || self.velocity.is_some()
            }
        }
    }

    pub(crate) fn resolved_spring(&self) -> SpringConfig {
        let mass = self.mass.unwrap_or(1.0).max(1e-4);
        let (stiffness, damping) =
            if self.stiffness.is_none() && self.damping.is_none() && (self.bounce.is_some() || self.duration.is_some()) {
                let dur = self.duration.unwrap_or(0.8).max(0.05);
                let zeta = (1.0 - self.bounce.unwrap_or(0.25)).clamp(0.05, 1.0);
                let omega0 = (6.0 / (zeta * dur)).max(1.0);
                let k = mass * omega0 * omega0;
                let c = 2.0 * zeta * (k * mass).sqrt();
                (k, c)
            } else {
                (
                    self.stiffness.unwrap_or(300.0).max(1e-4),
                    self.damping.unwrap_or(26.0).max(0.0),
                )
            };
        SpringConfig {
            stiffness,
            damping,
            mass,
            initial_velocity: self.velocity.unwrap_or(0.0),
            rest_delta: self.rest_delta.unwrap_or(0.01).max(1e-5),
            rest_speed: self.rest_speed.unwrap_or(0.01).max(1e-5),
        }
    }

    fn repeat_count(&self) -> Option<u32> {
        match &self.repeat {
            None => Some(0),
            Some(RepeatSpec::Count(n)) if *n < 0 => None,
            Some(RepeatSpec::Count(n)) => Some((*n).min(u32::MAX as i64) as u32),
            Some(RepeatSpec::Label(label))
                if label.eq_ignore_ascii_case("infinity") || label == "Infinity" =>
            {
                None
            }
            Some(RepeatSpec::Label(_)) => Some(0),
        }
    }

    fn repeat_behavior(&self) -> RepeatBehavior {
        match self.repeat_type.as_deref() {
            Some("reverse" | "mirror") => RepeatBehavior::Reverse,
            _ => RepeatBehavior::Loop,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionDescription {
    #[serde(default)]
    generation: u64,
    #[serde(default)]
    is_exit: bool,
    #[serde(default)]
    initial: Option<MotionInitial>,
    animate: MotionTargetStyle,
    #[serde(default)]
    transition: MotionTransition,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct MotionFrame {
    pub active: bool,
    pub just_settled: bool,
    pub generation: u64,
}

/// A scalar animation track that supports tweens, keyframes, physics springs,
/// and finite or infinite repeat loops.
#[derive(Clone, Debug)]
pub(crate) struct ScalarTrack {
    pub keyframes: Vec<f64>,
    pub times: Vec<f64>,
    pub is_spring: bool,
    pub spring: SpringConfig,
    pub duration: f64,
    pub delay: f64,
    pub ease: MotionEase,
    pub repeat: Option<u32>,
    pub repeat_behavior: RepeatBehavior,
    pub repeat_delay: f64,
    pub initial_velocity: f64,
}

impl ScalarTrack {
    pub(crate) fn from_transition(
        keyframes: Vec<f64>,
        transition: &MotionTransition,
        carried_velocity: f64,
    ) -> Self {
        let mut spring = transition.resolved_spring();
        let initial_velocity = if transition.velocity.is_some() {
            spring.initial_velocity
        } else {
            carried_velocity
        };
        spring.initial_velocity = initial_velocity;

        let count = keyframes.len().max(2);
        let times = match transition.times.as_ref() {
            Some(explicit) if explicit.len() == count => explicit.clone(),
            _ => (0..count)
                .map(|i| i as f64 / (count - 1) as f64)
                .collect(),
        };

        Self {
            keyframes,
            times,
            is_spring: transition.is_spring(),
            spring,
            duration: transition.duration.unwrap_or(0.3),
            delay: transition.delay,
            ease: transition.resolved_ease(),
            repeat: transition.repeat_count(),
            repeat_behavior: transition.repeat_behavior(),
            repeat_delay: transition.repeat_delay.max(0.0),
            initial_velocity,
        }
    }

    pub(crate) fn target_value(&self) -> f64 {
        let last = *self.keyframes.last().unwrap_or(&0.0);
        if self.repeat_behavior == RepeatBehavior::Reverse {
            if let Some(count) = self.repeat {
                if count % 2 == 1 {
                    return *self.keyframes.first().unwrap_or(&last);
                }
            }
        }
        last
    }

    fn all_equal(&self) -> bool {
        let Some(&first) = self.keyframes.first() else {
            return true;
        };
        self.keyframes.iter().all(|v| (*v - first).abs() <= 1e-9)
    }

    pub(crate) fn sample(&self, elapsed: Duration) -> (f64, f64, bool) {
        let first = *self.keyframes.first().unwrap_or(&0.0);
        let final_target = self.target_value();
        if self.all_equal() && (!self.is_spring || self.initial_velocity.abs() <= self.spring.rest_speed) {
            return (final_target, 0.0, false);
        }
        let delay = seconds(self.delay);
        if elapsed < delay {
            return (first, 0.0, !self.all_equal() || self.initial_velocity.abs() > self.spring.rest_speed);
        }
        let active_elapsed = elapsed.saturating_sub(delay).as_secs_f64();

        if self.is_spring && self.keyframes.len() <= 2 && self.repeat == Some(0) {
            let from = first;
            let to = *self.keyframes.last().unwrap_or(&from);
            return solve_spring(from, to, self.initial_velocity, self.spring, active_elapsed);
        }

        let cycle_dur = if self.is_spring {
            self.spring_cycle_duration()
        } else {
            self.duration
        };
        if cycle_dur <= 0.0 {
            return (final_target, 0.0, false);
        }

        let span = cycle_dur + self.repeat_delay;
        let max_cycles = self.repeat.map(|r| r as f64 + 1.0);
        let raw_cycle = active_elapsed / span;
        if let Some(total) = max_cycles {
            if raw_cycle >= total {
                return (final_target, 0.0, false);
            }
        }

        let cycle_index = raw_cycle.floor() as u64;
        let in_cycle = active_elapsed - (cycle_index as f64) * span;
        let clamped_in_cycle = in_cycle.min(cycle_dur);
        let reverse = self.repeat_behavior == RepeatBehavior::Reverse && cycle_index % 2 == 1;

        if self.is_spring && self.keyframes.len() <= 2 {
            let (from, to) = if reverse {
                (*self.keyframes.last().unwrap_or(&first), first)
            } else {
                (first, *self.keyframes.last().unwrap_or(&first))
            };
            let (pos, vel, _) = solve_spring(from, to, 0.0, self.spring, clamped_in_cycle);
            return (pos, vel, true);
        }

        let norm = (clamped_in_cycle / cycle_dur).clamp(0.0, 1.0);
        let norm = if reverse { 1.0 - norm } else { norm };
        let value = sample_keyframes(&self.keyframes, &self.times, norm, &self.ease);
        let vel = (sample_keyframes(
            &self.keyframes,
            &self.times,
            (norm + 1e-4).clamp(0.0, 1.0),
            &self.ease,
        ) - value)
            / (1e-4 * cycle_dur.max(1e-4));
        (value, if reverse { -vel } else { vel }, true)
    }

    fn spring_cycle_duration(&self) -> f64 {
        let from = *self.keyframes.first().unwrap_or(&0.0);
        let to = *self.keyframes.last().unwrap_or(&from);
        if (from - to).abs() <= self.spring.rest_delta && self.initial_velocity.abs() <= self.spring.rest_speed {
            return 0.0;
        }
        let step = 1.0 / 120.0;
        let mut t = step;
        while t < 30.0 {
            let (_, _, active) = solve_spring(from, to, 0.0, self.spring, t);
            if !active {
                return t;
            }
            t += step;
        }
        2.0
    }
}

fn sample_keyframes(values: &[f64], times: &[f64], norm: f64, ease_mode: &MotionEase) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    if values.len() == 1 || norm <= times[0] {
        return values[0];
    }
    let last_idx = values.len() - 1;
    if norm >= times[last_idx] {
        return values[last_idx];
    }
    for i in 0..last_idx {
        let t0 = times[i];
        let t1 = times[i + 1];
        if norm <= t1 || i + 1 == last_idx {
            let span = (t1 - t0).max(1e-9);
            let local_t = ((norm - t0) / span).clamp(0.0, 1.0);
            let progress = ease(local_t, ease_mode);
            return values[i] + (values[i + 1] - values[i]) * progress;
        }
    }
    values[last_idx]
}

/// Analytical damped harmonic oscillator matching Framer Motion spring physics.
pub(crate) fn solve_spring(
    from: f64,
    target: f64,
    v0: f64,
    cfg: SpringConfig,
    t: f64,
) -> (f64, f64, bool) {
    let x0 = from - target;
    if x0.abs() <= cfg.rest_delta && v0.abs() <= cfg.rest_speed {
        return (target, 0.0, false);
    }
    if t <= 0.0 {
        return (from, v0, true);
    }

    let k = cfg.stiffness.max(1e-4);
    let m = cfg.mass.max(1e-4);
    let c = cfg.damping.max(0.0);
    let omega0 = (k / m).sqrt();
    let zeta = c / (2.0 * (k * m).sqrt());

    let (x, v) = if zeta < 1.0 - 1e-6 {
        let omega_d = omega0 * (1.0 - zeta * zeta).sqrt();
        let env = (-zeta * omega0 * t).exp();
        let a = x0;
        let b = (v0 + zeta * omega0 * x0) / omega_d;
        let cos_wt = (omega_d * t).cos();
        let sin_wt = (omega_d * t).sin();
        let disp = env * (a * cos_wt + b * sin_wt);
        let vel = env
            * (((-zeta * omega0 * a) + omega_d * b) * cos_wt
                - ((zeta * omega0 * b) + omega_d * a) * sin_wt);
        (disp, vel)
    } else if (zeta - 1.0).abs() <= 1e-6 {
        let env = (-omega0 * t).exp();
        let slope = v0 + omega0 * x0;
        let disp = env * (x0 + slope * t);
        let vel = env * (v0 - omega0 * slope * t);
        (disp, vel)
    } else {
        let gamma = omega0 * (zeta * zeta - 1.0).sqrt();
        let r1 = -omega0 * zeta + gamma;
        let r2 = -omega0 * zeta - gamma;
        let c2 = (v0 - r1 * x0) / (r2 - r1);
        let c1 = x0 - c2;
        let e1 = (r1 * t).exp();
        let e2 = (r2 * t).exp();
        (c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2)
    };

    if (x.abs() <= cfg.rest_delta && v.abs() <= cfg.rest_speed) || t >= 30.0 {
        (target, 0.0, false)
    } else {
        (target + x, v, true)
    }
}

pub(crate) struct MotionState {
    source: serde_json::Value,
    tracks: HashMap<MotionProp, ScalarTrack>,
    static_values: MotionStyle,
    started: Instant,
    valid: bool,
    needs_settle: bool,
    generation: u64,
}

impl MotionState {
    pub(crate) fn new(source: &serde_json::Value, now: Instant) -> Result<Self, String> {
        let description = parse_description(source)?;
        let initial_style = match description.initial {
            Some(MotionInitial::Style(style)) => Some(style),
            Some(MotionInitial::Disabled(false)) | None => None,
            Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
        };
        let (tracks, static_values, has_movement) = build_tracks(
            initial_style,
            &MotionStyle::default(),
            &description.animate,
            &description.transition,
            None,
        );
        Ok(Self {
            source: source.clone(),
            tracks,
            static_values,
            started: now,
            valid: true,
            needs_settle: description.is_exit || has_movement,
            generation: description.generation,
        })
    }

    pub(crate) fn invalid(source: &serde_json::Value, now: Instant) -> Self {
        Self {
            source: source.clone(),
            tracks: HashMap::new(),
            static_values: MotionStyle::default(),
            started: now,
            valid: false,
            needs_settle: source_is_exit(source),
            generation: source_generation(source),
        }
    }

    pub(crate) fn sync(&mut self, source: &serde_json::Value, now: Instant) -> Result<(), String> {
        if self.source == *source {
            return Ok(());
        }

        let previous_generation = self.generation;
        let description = match parse_description(source) {
            Ok(description) => description,
            Err(error) => {
                self.source = source.clone();
                self.valid = false;
                self.generation = source_generation(source);
                self.needs_settle =
                    source_is_exit(source) || self.generation != previous_generation;
                return Err(error);
            }
        };

        let (current_style, velocities) = if self.valid {
            self.sample_with_velocities(now)
        } else {
            (MotionStyle::default(), HashMap::new())
        };
        let initial_override = if self.valid {
            None
        } else {
            match description.initial {
                Some(MotionInitial::Style(style)) => Some(style),
                Some(MotionInitial::Disabled(false)) | None => None,
                Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
            }
        };

        let (tracks, static_values, has_movement) = build_tracks(
            initial_override,
            &current_style,
            &description.animate,
            &description.transition,
            Some(&velocities),
        );

        self.tracks = tracks;
        self.static_values = static_values;
        self.started = now;
        self.source = source.clone();
        self.valid = true;
        self.generation = description.generation;
        self.needs_settle =
            description.is_exit || self.generation != previous_generation || has_movement;
        Ok(())
    }

    pub(crate) fn visible_style(&self, now: Instant) -> Option<MotionStyle> {
        self.valid.then(|| self.sample(now).0)
    }

    fn sample_with_velocities(&self, now: Instant) -> (MotionStyle, HashMap<MotionProp, f64>) {
        let elapsed = now.saturating_duration_since(self.started);
        let mut style = self.static_values;
        let mut velocities = HashMap::new();
        for (&prop, track) in &self.tracks {
            let (val, vel, _) = track.sample(elapsed);
            style.set(prop, Some(val));
            velocities.insert(prop, vel);
        }
        (style, velocities)
    }

    fn sample(&self, now: Instant) -> (MotionStyle, bool) {
        let elapsed = now.saturating_duration_since(self.started);
        let mut style = self.static_values;
        let mut active = false;
        for (&prop, track) in &self.tracks {
            let (val, _, prop_active) = track.sample(elapsed);
            style.set(prop, Some(val));
            active |= prop_active;
        }
        (style, active)
    }

    pub(crate) fn frame(&mut self, now: Instant) -> MotionFrame {
        let (_, active) = if self.valid {
            self.sample(now)
        } else {
            (MotionStyle::default(), false)
        };
        if active {
            self.needs_settle = true;
        }
        let just_settled = self.needs_settle && !active;
        if just_settled {
            self.needs_settle = false;
        }
        MotionFrame {
            active,
            just_settled,
            generation: self.generation,
        }
    }
}

fn build_tracks(
    initial_override: Option<MotionStyle>,
    previous_style: &MotionStyle,
    animate: &MotionTargetStyle,
    transition: &MotionTransition,
    carried_velocities: Option<&HashMap<MotionProp, f64>>,
) -> (HashMap<MotionProp, ScalarTrack>, MotionStyle, bool) {
    let mut tracks = HashMap::new();
    let mut static_values = *previous_style;
    let mut has_movement = false;

    for prop in ALL_MOTION_PROPS {
        let Some(target_val) = animate.get(prop) else {
            continue;
        };
        let fallback_from = initial_override
            .and_then(|s| s.get(prop))
            .or_else(|| previous_style.get(prop));
        let keyframes = resolve_keyframes(target_val, fallback_from);
        if keyframes.is_empty() {
            continue;
        }
        static_values.set(prop, None);
        let from_val = keyframes[0];
        let to_val = *keyframes.last().unwrap_or(&from_val);
        let vel = carried_velocities
            .and_then(|v| v.get(&prop).copied())
            .unwrap_or(0.0);
        if keyframes.len() > 2 || (from_val - to_val).abs() > 1e-9 || vel.abs() > 1e-5 {
            has_movement = true;
        }
        tracks.insert(prop, ScalarTrack::from_transition(keyframes, transition, vel));
    }

    (tracks, static_values, has_movement)
}

fn resolve_keyframes(target: &MotionTargetValue, fallback_from: Option<f64>) -> Vec<f64> {
    match target {
        MotionTargetValue::Single(to) => {
            let from = fallback_from.unwrap_or(*to);
            vec![from, *to]
        }
        MotionTargetValue::Keyframes(items) => {
            let mut out = Vec::with_capacity(items.len());
            for (idx, item) in items.iter().enumerate() {
                let resolved = item.unwrap_or_else(|| {
                    if idx == 0 {
                        fallback_from.unwrap_or(0.0)
                    } else {
                        *out.last().unwrap_or(&0.0)
                    }
                });
                out.push(resolved);
            }
            if out.len() == 1 {
                let to = out[0];
                vec![fallback_from.unwrap_or(to), to]
            } else {
                out
            }
        }
    }
}

fn source_generation(source: &serde_json::Value) -> u64 {
    source
        .get("generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default()
}

fn source_is_exit(source: &serde_json::Value) -> bool {
    source
        .get("isExit")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_default()
}

fn parse_description(source: &serde_json::Value) -> Result<MotionDescription, String> {
    let description: MotionDescription =
        serde_json::from_value(source.clone()).map_err(|error| error.to_string())?;

    if matches!(description.initial, Some(MotionInitial::Disabled(true))) {
        return Err("motion initial only accepts false or a style object".to_string());
    }
    validate_target_style(&description.animate)?;
    if let Some(MotionInitial::Style(initial)) = &description.initial {
        validate_style(initial)?;
    }
    validate_transition(&description.transition)?;
    Ok(description)
}

pub(crate) fn validate_transition(transition: &MotionTransition) -> Result<(), String> {
    if let Some(duration) = transition.duration {
        validate_seconds(duration, "duration")?;
    }
    validate_seconds(transition.delay, "delay")?;
    validate_seconds(transition.repeat_delay, "repeatDelay")?;
    if let Some(ref ease) = transition.ease {
        validate_ease(ease)?;
    }
    for (name, val) in [
        ("stiffness", transition.stiffness),
        ("damping", transition.damping),
        ("mass", transition.mass),
        ("velocity", transition.velocity),
        ("bounce", transition.bounce),
        ("restDelta", transition.rest_delta),
        ("restSpeed", transition.rest_speed),
    ] {
        if let Some(v) = val {
            if !v.is_finite() || v.abs() > f32::MAX as f64 {
                return Err(format!("motion {name} must be finite"));
            }
        }
    }
    if transition.mass.is_some_and(|m| m <= 0.0) || transition.stiffness.is_some_and(|k| k <= 0.0) {
        return Err("motion spring mass and stiffness must be positive".to_string());
    }
    if transition.damping.is_some_and(|c| c < 0.0) {
        return Err("motion spring damping must be non-negative".to_string());
    }
    if let Some(ref times) = transition.times {
        for &t in times {
            if !t.is_finite() || !(0.0..=1.0).contains(&t) {
                return Err("motion times must be between 0 and 1".to_string());
            }
        }
    }
    Ok(())
}

fn validate_scalar_prop(prop: MotionProp, value: f64) -> Result<(), String> {
    let name = prop.name();
    if !value.is_finite() || value.abs() > f32::MAX as f64 {
        return Err(format!("motion {name} must fit a finite 32-bit float"));
    }
    if matches!(
        prop,
        MotionProp::Width
            | MotionProp::Height
            | MotionProp::BorderRadius
            | MotionProp::Blur
            | MotionProp::BackdropBlur
    ) && value < 0.0
    {
        return Err("motion sizes, blur, and borderRadius must be non-negative".to_string());
    }
    if prop == MotionProp::Opacity && !(0.0..=1.0).contains(&value) {
        return Err("motion opacity must be between 0 and 1".to_string());
    }
    Ok(())
}

fn validate_style(style: &MotionStyle) -> Result<(), String> {
    for prop in ALL_MOTION_PROPS {
        if let Some(val) = style.get(prop) {
            validate_scalar_prop(prop, val)?;
        }
    }
    Ok(())
}

fn validate_target_style(style: &MotionTargetStyle) -> Result<(), String> {
    for prop in ALL_MOTION_PROPS {
        let Some(target) = style.get(prop) else {
            continue;
        };
        match target {
            MotionTargetValue::Single(v) => validate_scalar_prop(prop, *v)?,
            MotionTargetValue::Keyframes(items) => {
                if items.is_empty() {
                    return Err(format!("motion {} keyframes cannot be empty", prop.name()));
                }
                for item in items.iter().flatten() {
                    validate_scalar_prop(prop, *item)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_seconds(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 || Duration::try_from_secs_f64(value).is_err() {
        return Err(format!(
            "motion {name} must be a supported finite non-negative number"
        ));
    }
    Ok(())
}

fn validate_ease(ease: &MotionEase) -> Result<(), String> {
    match ease {
        MotionEase::Name(name)
            if matches!(
                name.as_str(),
                "linear"
                    | "ease"
                    | "easeIn"
                    | "easeOut"
                    | "easeInOut"
                    | "circIn"
                    | "circOut"
                    | "circInOut"
                    | "backIn"
                    | "backOut"
                    | "backInOut"
            ) => {}
        MotionEase::Name(name) => return Err(format!("unknown motion easing: {name}")),
        MotionEase::CubicBezier([x1, y1, x2, y2]) => {
            if ![x1, y1, x2, y2].iter().all(|value| value.is_finite())
                || !(0.0..=1.0).contains(x1)
                || !(0.0..=1.0).contains(x2)
            {
                return Err(
                    "motion cubic bezier values must be finite and x values must be 0..1"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

fn seconds(value: f64) -> Duration {
    Duration::try_from_secs_f64(value).expect("motion durations are validated when parsed")
}

fn ease(progress: f64, ease: &MotionEase) -> f64 {
    let curve = match ease {
        MotionEase::CubicBezier(curve) => *curve,
        MotionEase::Name(name) => match name.as_str() {
            "linear" => return progress,
            "easeIn" => [0.42, 0.0, 1.0, 1.0],
            "easeInOut" => [0.42, 0.0, 0.58, 1.0],
            "ease" => [0.25, 0.1, 0.25, 1.0],
            "circIn" => [0.55, 0.0, 1.0, 0.45],
            "circOut" => [0.0, 0.55, 0.45, 1.0],
            "circInOut" => [0.85, 0.0, 0.15, 1.0],
            "backIn" => [0.36, 0.0, 0.66, -0.56],
            "backOut" => [0.34, 1.56, 0.64, 1.0],
            "backInOut" => [0.68, -0.6, 0.32, 1.6],
            _ => [0.0, 0.0, 0.58, 1.0],
        },
    };
    cubic_bezier(progress, curve)
}

fn cubic_bezier(x: f64, [x1, y1, x2, y2]: [f64; 4]) -> f64 {
    fn sample(t: f64, a: f64, b: f64) -> f64 {
        let c = 3.0 * a;
        let b = 3.0 * (b - a) - c;
        let a = 1.0 - c - b;
        ((a * t + b) * t + c) * t
    }

    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..20 {
        let middle = (low + high) / 2.0;
        if sample(middle, x1, x2) < x {
            low = middle;
        } else {
            high = middle;
        }
    }
    sample((low + high) / 2.0, y1, y2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_and_retargets_from_the_visible_value() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let middle = state.frame(started + Duration::from_millis(500));
        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(500))
                .unwrap()
                .width,
            Some(50.0)
        );
        assert!(middle.active);
        assert!(!middle.just_settled);

        let reversed = serde_json::json!({
            "initial": false,
            "animate": { "width": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let reversed_at = started + Duration::from_millis(500);
        state.sync(&reversed, reversed_at).unwrap();
        assert_eq!(state.visible_style(reversed_at).unwrap().width, Some(50.0));
        assert_eq!(
            state
                .visible_style(reversed_at + Duration::from_millis(500))
                .unwrap()
                .width,
            Some(25.0)
        );
    }

    #[test]
    fn disabled_initial_state_starts_at_the_target() {
        let now = Instant::now();
        let description = serde_json::json!({
            "initial": false,
            "animate": { "width": 260.0 },
            "transition": { "duration": 0.2 }
        });
        let mut state = MotionState::new(&description, now).unwrap();
        let frame = state.frame(now);

        assert_eq!(state.visible_style(now).unwrap().width, Some(260.0));
        assert!(!frame.active);
        assert!(!frame.just_settled);
    }

    #[test]
    fn rejects_unsafe_numbers_and_invalid_initial_booleans() {
        let now = Instant::now();
        for description in [
            serde_json::json!({ "animate": { "width": 1e300 }, "transition": {} }),
            serde_json::json!({ "animate": { "opacity": 2.0 }, "transition": {} }),
            serde_json::json!({ "animate": {}, "transition": { "duration": 1e300 } }),
            serde_json::json!({ "initial": true, "animate": {}, "transition": {} }),
        ] {
            assert!(MotionState::new(&description, now).is_err());
        }
    }

    #[test]
    fn finishes_at_the_exact_target() {
        let started = Instant::now();
        let description = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 0.2, "ease": "linear" }
        });
        let mut state = MotionState::new(&description, started).unwrap();
        let frame = state.frame(started + Duration::from_millis(200));

        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(200))
                .unwrap()
                .width,
            Some(100.0)
        );
        assert!(!frame.active);
        assert!(frame.just_settled);
        assert!(
            !state
                .frame(started + Duration::from_millis(201))
                .just_settled
        );
    }

    #[test]
    fn retarget_with_zero_duration_settles_on_the_next_frame() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": false,
            "animate": { "opacity": 1.0 },
            "transition": { "duration": 0.2, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();
        assert!(!state.frame(started).just_settled);

        let exit = serde_json::json!({
            "initial": false,
            "animate": { "opacity": 0.0 },
            "transition": { "duration": 0.0, "ease": "linear" }
        });
        state.sync(&exit, started).unwrap();
        let frame = state.frame(started);
        assert_eq!(state.visible_style(started).unwrap().opacity, Some(0.0));
        assert!(!frame.active);
        assert!(frame.just_settled);
    }

    #[test]
    fn a_new_generation_settles_when_the_target_already_matches() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "generation": 1,
            "initial": false,
            "animate": { "opacity": 1.0 }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let exit = serde_json::json!({
            "generation": 2,
            "initial": false,
            "animate": { "opacity": 1.0 }
        });
        state.sync(&exit, started).unwrap();

        assert!(state.frame(started).just_settled);
        assert!(!state.frame(started).just_settled);
    }

    #[test]
    fn retarget_keeps_values_omitted_from_the_new_target() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "generation": 1,
            "initial": false,
            "animate": { "width": 100.0, "opacity": 1.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let exit = serde_json::json!({
            "generation": 2,
            "initial": false,
            "animate": { "opacity": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        state.sync(&exit, started).unwrap();

        state.frame(started + Duration::from_millis(500));
        let style = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        assert_eq!(style.width, Some(100.0));
        assert_eq!(style.opacity, Some(0.5));
    }

    #[test]
    fn spring_solver_converges_in_underdamped_critical_and_overdamped_regimes() {
        for (stiffness, damping) in [(300.0, 14.0), (400.0, 40.0), (200.0, 50.0)] {
            let cfg = SpringConfig {
                stiffness,
                damping,
                mass: 1.0,
                initial_velocity: 0.0,
                rest_delta: 0.005,
                rest_speed: 0.005,
            };
            let (mid, _, active_mid) = solve_spring(0.0, 100.0, 0.0, cfg, 0.05);
            assert!(active_mid);
            assert!(mid > 0.0);

            let (end, vel, active_end) = solve_spring(0.0, 100.0, 0.0, cfg, 3.0);
            assert!(!active_end);
            assert_eq!(end, 100.0);
            assert_eq!(vel, 0.0);
        }
    }

    #[test]
    fn motion_transforms_keyframes_and_repeats_apply_to_style() {
        let started = Instant::now();
        let desc = serde_json::json!({
            "initial": { "x": 0.0, "scale": 1.0, "rotate": 0.0 },
            "animate": { "x": [0.0, 100.0, 50.0], "scale": 1.25, "rotate": 90.0 },
            "transition": { "duration": 1.0, "ease": "linear", "times": [0.0, 0.5, 1.0] }
        });
        let state = MotionState::new(&desc, started).unwrap();
        let peak = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        assert!((peak.x.unwrap() - 100.0).abs() < 1e-4);
        assert!((peak.scale.unwrap() - 1.125).abs() < 1e-4);
        assert!((peak.rotate.unwrap() - 45.0).abs() < 1e-4);

        let mut style = StyleDesc::default();
        peak.apply_to(&mut style);
        let tx = style.transform.unwrap();
        assert!((tx.translate_x.unwrap() - 100.0).abs() < 1e-4);
        assert!((tx.scale.unwrap() - 1.125).abs() < 1e-4);
        assert!((tx.rotate.unwrap() - 45.0).abs() < 1e-4);

        // Repeat reverse alternates smoothly past 1 cycle.
        let loop_desc = serde_json::json!({
            "initial": { "x": 0.0 },
            "animate": { "x": 100.0 },
            "transition": { "duration": 1.0, "ease": "linear", "repeat": 1, "repeatType": "reverse" }
        });
        let loop_state = MotionState::new(&loop_desc, started).unwrap();
        let back = loop_state
            .visible_style(started + Duration::from_millis(1500))
            .unwrap();
        assert!((back.x.unwrap() - 50.0).abs() < 1e-4);
        let settled = loop_state
            .visible_style(started + Duration::from_millis(2000))
            .unwrap();
        assert!((settled.x.unwrap() - 0.0).abs() < 1e-4);
    }

    #[test]
    fn interrupted_spring_preserves_momentum() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "x": 0.0 },
            "animate": { "x": 200.0 },
            "transition": { "type": "spring", "stiffness": 220.0, "damping": 20.0 }
        });
        let mut state = MotionState::new(&initial, started).unwrap();
        let t1 = started + Duration::from_millis(60);
        let (_, vel1) = state.sample_with_velocities(t1);
        assert!(vel1[&MotionProp::X] > 100.0);

        let retarget = serde_json::json!({
            "initial": false,
            "animate": { "x": 0.0 },
            "transition": { "type": "spring", "stiffness": 220.0, "damping": 20.0 }
        });
        state.sync(&retarget, t1).unwrap();
        // Immediately after reversal, positive momentum keeps x momentarily advancing before returning.
        let x_right_after = state.visible_style(t1 + Duration::from_millis(8)).unwrap().x.unwrap();
        let x_at_turn = state.visible_style(t1).unwrap().x.unwrap();
        assert!(x_right_after > x_at_turn);
    }
}
