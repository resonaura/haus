//! Native imperative MotionValue registry (`useMotionValue`, `useSpring`, `useTransform`,
//! and `animate()`) ticked on GPUI's native frame loop with zero React commits.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;
use web_time::Instant;

static MOTION_VALUES_EPOCH: AtomicU64 = AtomicU64::new(1);

#[inline]
fn bump_motion_epoch() {
    MOTION_VALUES_EPOCH.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub(crate) fn motion_values_epoch() -> u64 {
    MOTION_VALUES_EPOCH.load(Ordering::Relaxed)
}

use crate::motion::{
    apply_scalar_property, solve_spring, validate_transition, MotionTargetValue, MotionTransition,
    ScalarTrack, SpringConfig,
};
use crate::style::{MotionBindDesc, StyleDesc};

#[derive(Clone, Debug)]
enum MotionValueEntry {
    Direct {
        value: f64,
        velocity: f64,
        started: Instant,
        animation: Option<ScalarTrack>,
    },
    SpringFollow {
        source_id: String,
        spring: SpringConfig,
        value: f64,
        velocity: f64,
        anchor_from: f64,
        anchor_v0: f64,
        anchor_target: f64,
        started: Instant,
        active: bool,
    },
    Transform {
        source_id: String,
        input_range: Vec<f64>,
        output_range: Vec<f64>,
        clamp: bool,
    },
}

thread_local! {
    static MOTION_VALUES: RefCell<HashMap<String, MotionValueEntry>> =
        RefCell::new(HashMap::new());
}

pub(crate) fn has_active_motion_values() -> bool {
    MOTION_VALUES.with(|cell| {
        cell.borrow().values().any(|entry| match entry {
            MotionValueEntry::Direct { animation, .. } => animation.is_some(),
            MotionValueEntry::SpringFollow { active, .. } => *active,
            MotionValueEntry::Transform { .. } => false,
        })
    })
}

fn is_entry_active(map: &HashMap<String, MotionValueEntry>, id: &str, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    let Some(entry) = map.get(id) else {
        return false;
    };
    match entry {
        MotionValueEntry::Direct { animation, .. } => animation.is_some(),
        MotionValueEntry::SpringFollow {
            source_id, active, ..
        } => *active || is_entry_active(map, source_id, depth + 1),
        MotionValueEntry::Transform { source_id, .. } => is_entry_active(map, source_id, depth + 1),
    }
}

pub(crate) fn are_motion_bindings_active(bindings: &[MotionBindDesc]) -> bool {
    if bindings.is_empty() {
        return false;
    }
    MOTION_VALUES.with(|cell| {
        let map = cell.borrow();
        bindings
            .iter()
            .any(|binding| is_entry_active(&map, &binding.source_id, 0))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimateSpec {
    to: MotionTargetValue,
    from: Option<f64>,
    #[serde(default)]
    transition: MotionTransition,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ConfigureSpec {
    #[serde(rename_all = "camelCase")]
    Value {
        initial: f64,
    },
    #[serde(rename_all = "camelCase")]
    Spring {
        source_id: String,
        initial: Option<f64>,
        #[serde(flatten)]
        transition: MotionTransition,
    },
    #[serde(rename_all = "camelCase")]
    Transform {
        source_id: String,
        input_range: Vec<f64>,
        output_range: Vec<f64>,
        clamp: Option<bool>,
    },
    Remove,
}

fn resolve_locked(map: &HashMap<String, MotionValueEntry>, id: &str, depth: usize) -> Option<f64> {
    if depth > 16 {
        return None;
    }
    match map.get(id)? {
        MotionValueEntry::Direct { value, .. } => Some(*value),
        MotionValueEntry::SpringFollow { value, .. } => Some(*value),
        MotionValueEntry::Transform {
            source_id,
            input_range,
            output_range,
            clamp,
        } => {
            let input = resolve_locked(map, source_id, depth + 1)?;
            Some(interpolate_piecewise(input, input_range, output_range, *clamp))
        }
    }
}

fn interpolate_piecewise(value: f64, input: &[f64], output: &[f64], clamp: bool) -> f64 {
    let count = input.len().min(output.len());
    if count == 0 {
        return value;
    }
    if count == 1 {
        return output[0];
    }
    let last = count - 1;
    let increasing = input[last] >= input[0];
    if clamp {
        if increasing && value <= input[0] {
            return output[0];
        }
        if increasing && value >= input[last] {
            return output[last];
        }
        if !increasing && value >= input[0] {
            return output[0];
        }
        if !increasing && value <= input[last] {
            return output[last];
        }
    }
    for i in 0..last {
        let i0 = input[i];
        let i1 = input[i + 1];
        let in_segment = if increasing {
            value <= i1 || i + 1 == last
        } else {
            value >= i1 || i + 1 == last
        };
        if in_segment {
            let span = i1 - i0;
            let mut t = if span.abs() < 1e-9 {
                if (increasing && value >= i1) || (!increasing && value <= i1) {
                    1.0
                } else {
                    0.0
                }
            } else {
                (value - i0) / span
            };
            if clamp {
                t = t.clamp(0.0, 1.0);
            }
            return output[i] + (output[i + 1] - output[i]) * t;
        }
    }
    output[last]
}

pub(crate) fn set_motion_value(id: &str, value: f64, now: Instant) {
    if !value.is_finite() {
        return;
    }
    MOTION_VALUES.with(|cell| {
        let mut map = cell.borrow_mut();
        let unchanged = matches!(
            map.get(id),
            Some(MotionValueEntry::Direct {
                value: prev,
                animation: None,
                ..
            }) if prev.to_bits() == value.to_bits()
        );
        if unchanged {
            return;
        }
        bump_motion_epoch();
        map.insert(
            id.to_string(),
            MotionValueEntry::Direct {
                value,
                velocity: 0.0,
                started: now,
                animation: None,
            },
        );
    });
}

pub(crate) fn get_motion_value(id: &str) -> Option<f64> {
    MOTION_VALUES.with(|cell| resolve_locked(&cell.borrow(), id, 0))
}

pub(crate) fn animate_motion_value(id: &str, spec_json: &str, now: Instant) -> Result<(), String> {
    let spec: AnimateSpec = serde_json::from_str(spec_json).map_err(|e| e.to_string())?;
    validate_transition(&spec.transition)?;

    MOTION_VALUES.with(|cell| {
        let mut map = cell.borrow_mut();
        let (current_val, current_vel) = match map.get(id) {
            Some(MotionValueEntry::Direct { value, velocity, .. }) => (*value, *velocity),
            _ => (spec.from.unwrap_or(0.0), 0.0),
        };
        let from_val = spec.from.unwrap_or(current_val);
        let keyframes = match spec.to {
            MotionTargetValue::Single(to) => {
                if !to.is_finite() {
                    return Err("motion target must be finite".to_string());
                }
                vec![from_val, to]
            }
            MotionTargetValue::Keyframes(items) => {
                if items.is_empty() {
                    return Err("motion keyframes cannot be empty".to_string());
                }
                let mut out = Vec::with_capacity(items.len());
                for (i, item) in items.iter().enumerate() {
                    let v = item.unwrap_or(if i == 0 {
                        from_val
                    } else {
                        *out.last().unwrap_or(&from_val)
                    });
                    if !v.is_finite() {
                        return Err("motion keyframe must be finite".to_string());
                    }
                    out.push(v);
                }
                if out.len() == 1 {
                    vec![from_val, out[0]]
                } else {
                    out
                }
            }
        };

        let track = ScalarTrack::from_transition(keyframes, &spec.transition, current_vel);
        bump_motion_epoch();
        map.insert(
            id.to_string(),
            MotionValueEntry::Direct {
                value: from_val,
                velocity: current_vel,
                started: now,
                animation: Some(track),
            },
        );
        Ok(())
    })
}

pub(crate) fn configure_motion_value(id: &str, config_json: &str, now: Instant) -> Result<(), String> {
    let spec: ConfigureSpec = serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    MOTION_VALUES.with(|cell| {
        let mut map = cell.borrow_mut();
        match spec {
            ConfigureSpec::Value { initial } => {
                if !initial.is_finite() {
                    return Err("motion initial value must be finite".to_string());
                }
                if !map.contains_key(id) {
                    bump_motion_epoch();
                    map.insert(
                        id.to_string(),
                        MotionValueEntry::Direct {
                            value: initial,
                            velocity: 0.0,
                            started: now,
                            animation: None,
                        },
                    );
                }
            }
            ConfigureSpec::Spring {
                source_id,
                initial,
                transition,
            } => {
                validate_transition(&transition)?;
                let spring = transition.resolved_spring();
                let source_val = resolve_locked(&map, &source_id, 0).or(initial).unwrap_or(0.0);
                let existing = map.get(id).and_then(|e| match e {
                    MotionValueEntry::SpringFollow {
                        value, velocity, ..
                    } => Some((*value, *velocity)),
                    _ => None,
                });
                let (cur_val, cur_vel) = existing.unwrap_or((initial.unwrap_or(source_val), 0.0));
                let active = (cur_val - source_val).abs() > spring.rest_delta
                    || cur_vel.abs() > spring.rest_speed;
                if existing.is_none() || active {
                    bump_motion_epoch();
                }
                map.insert(
                    id.to_string(),
                    MotionValueEntry::SpringFollow {
                        source_id,
                        spring,
                        value: cur_val,
                        velocity: cur_vel,
                        anchor_from: cur_val,
                        anchor_v0: cur_vel,
                        anchor_target: source_val,
                        started: now,
                        active,
                    },
                );
            }
            ConfigureSpec::Transform {
                source_id,
                input_range,
                output_range,
                clamp,
            } => {
                if input_range.len() != output_range.len() || input_range.len() < 2 {
                    return Err(
                        "useTransform requires equal-length input/output ranges with at least 2 entries"
                            .to_string(),
                    );
                }
                bump_motion_epoch();
                map.insert(
                    id.to_string(),
                    MotionValueEntry::Transform {
                        source_id,
                        input_range,
                        output_range,
                        clamp: clamp.unwrap_or(true),
                    },
                );
            }
            ConfigureSpec::Remove => {
                if map.remove(id).is_some() {
                    bump_motion_epoch();
                }
            }
        }
        Ok(())
    })
}

pub(crate) fn tick_motion_values(now: Instant) -> bool {
    MOTION_VALUES.with(|cell| {
        let mut map = cell.borrow_mut();
        let mut any_active = false;
        let mut any_changed = false;

        // 1. Advance direct imperative tracks.
        for entry in map.values_mut() {
            if let MotionValueEntry::Direct {
                value,
                velocity,
                started,
                animation,
            } = entry
            {
                if let Some(track) = animation {
                    let (pos, vel, active) = track.sample(now.saturating_duration_since(*started));
                    *value = pos;
                    *velocity = vel;
                    any_changed = true;
                    if active {
                        any_active = true;
                    } else {
                        *velocity = 0.0;
                        *animation = None;
                    }
                }
            }
        }

        // 2. Advance spring followers driven by source MotionValues.
        let follow_keys: Vec<String> = map
            .iter()
            .filter_map(|(id, e)| {
                matches!(e, MotionValueEntry::SpringFollow { .. }).then(|| id.clone())
            })
            .collect();

        for id in follow_keys {
            let Some(MotionValueEntry::SpringFollow {
                source_id,
                spring,
                anchor_from,
                anchor_v0,
                anchor_target,
                started,
                active: was_active,
                ..
            }) = map.get(&id).cloned()
            else {
                continue;
            };

            let Some(target) = resolve_locked(&map, &source_id, 0) else {
                continue;
            };
            if !was_active && (target - anchor_target).abs() <= 1e-6 {
                continue;
            }
            let elapsed = now.saturating_duration_since(started).as_secs_f64();
            let (cur_pos, cur_vel, mut active) =
                solve_spring(anchor_from, anchor_target, anchor_v0, spring, elapsed);

            let (next_from, next_v0, next_target, next_started, next_pos, next_vel) =
                if (target - anchor_target).abs() > 1e-6 {
                    let is_active = (cur_pos - target).abs() > spring.rest_delta
                        || cur_vel.abs() > spring.rest_speed;
                    active = is_active;
                    (cur_pos, cur_vel, target, now, cur_pos, cur_vel)
                } else {
                    (anchor_from, anchor_v0, anchor_target, started, cur_pos, cur_vel)
                };

            any_changed = true;
            any_active |= active;
            map.insert(
                id,
                MotionValueEntry::SpringFollow {
                    source_id,
                    spring,
                    value: next_pos,
                    velocity: next_vel,
                    anchor_from: next_from,
                    anchor_v0: next_v0,
                    anchor_target: next_target,
                    started: next_started,
                    active,
                },
            );
        }

        if any_changed {
            bump_motion_epoch();
        }
        any_active
    })
}

pub(crate) fn apply_motion_bindings_to_style(style: &mut StyleDesc, bindings: &[MotionBindDesc]) {
    for binding in bindings {
        let Some(raw) = get_motion_value(&binding.source_id) else {
            continue;
        };
        let mapped = match (binding.input_range, binding.output_range) {
            (Some(inp), Some(out)) => {
                interpolate_piecewise(raw, &inp, &out, binding.clamp.unwrap_or(true))
            }
            _ => raw,
        };
        apply_scalar_property(style, &binding.property, mapped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn imperative_animation_transform_and_spring_follower_tick_together() {
        let t0 = Instant::now();
        set_motion_value("mv_src", 0.0, t0);
        configure_motion_value(
            "mv_derived",
            r#"{"kind":"transform","sourceId":"mv_src","inputRange":[0,100],"outputRange":[1,2]}"#,
            t0,
        )
        .unwrap();
        configure_motion_value(
            "mv_spring",
            r#"{"kind":"spring","sourceId":"mv_src","stiffness":300,"damping":25}"#,
            t0,
        )
        .unwrap();
        animate_motion_value(
            "mv_src",
            r#"{"to":100,"transition":{"duration":0.5,"ease":"linear"}}"#,
            t0,
        )
        .unwrap();

        for step in 1..=15 {
            tick_motion_values(t0 + Duration::from_millis(step * 16));
        }
        let mid_time = t0 + Duration::from_millis(250);
        assert!(tick_motion_values(mid_time));
        let src_mid = get_motion_value("mv_src").unwrap();
        let derived_mid = get_motion_value("mv_derived").unwrap();
        let spring_mid = get_motion_value("mv_spring").unwrap();
        assert!((src_mid - 50.0).abs() < 1e-4);
        assert!((derived_mid - 1.5).abs() < 1e-4);
        assert!(spring_mid > 0.0 && spring_mid < 100.0);

        // Once source finishes, spring settles after brief settle period.
        let mut active = true;
        for step in 1..=30 {
            active = tick_motion_values(t0 + Duration::from_millis(500 + step * 50));
            if !active {
                break;
            }
        }
        assert!(!active);
        assert_eq!(get_motion_value("mv_src").unwrap(), 100.0);
        assert_eq!(get_motion_value("mv_derived").unwrap(), 2.0);
        assert_eq!(get_motion_value("mv_spring").unwrap(), 100.0);
    }
}
