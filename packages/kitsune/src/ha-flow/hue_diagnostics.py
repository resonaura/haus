# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Read the minimum redacted Hue data needed to draw scene previews."""

from __future__ import annotations

import math
import re
from typing import Any

from homeassistant.core import HomeAssistant


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _xy(value: Any) -> dict[str, dict[str, float]] | None:
    color = value.get("xy") if isinstance(value, dict) else None
    if not isinstance(color, dict) or not _number(color.get("x")) or not _number(color.get("y")):
        return None
    return {"xy": {"x": color["x"], "y": color["y"]}}


def _color_temperature(value: Any) -> dict[str, dict[str, float]] | None:
    color = value.get("color_temperature") if isinstance(value, dict) else None
    mirek = color.get("mirek") if isinstance(color, dict) else None
    return {"color_temperature": {"mirek": mirek}} if _number(mirek) else None


def _palette_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    color = _xy(item.get("color"))
    temperature = _color_temperature(item)
    if color:
        return {"color": color}
    if temperature:
        return temperature
    return None


def _scene_resource(resource: dict[str, Any]) -> dict[str, Any] | None:
    kind = resource.get("type")
    resource_id = resource.get("id")
    metadata = resource.get("metadata")
    if kind in {"room", "zone"}:
        if not isinstance(resource_id, str):
            return None
        name = metadata.get("name") if isinstance(metadata, dict) else None
        return {
            "type": kind,
            "id": resource_id,
            "metadata": {"name": name} if isinstance(name, str) else {},
        }
    if kind != "scene" or not isinstance(resource_id, str):
        return None

    group = resource.get("group")
    summary: dict[str, Any] = {"type": "scene", "id": resource_id}
    name = metadata.get("name") if isinstance(metadata, dict) else None
    if isinstance(name, str):
        summary["metadata"] = {"name": name}
    if isinstance(group, dict) and isinstance(group.get("rid"), str):
        summary["group"] = {"rid": group["rid"]}

    palette = resource.get("palette")
    if isinstance(palette, dict):
        safe_palette = {
            key: colors
            for key, raw in (
                ("color", palette.get("color")),
                ("color_temperature", palette.get("color_temperature")),
            )
            if isinstance(raw, list)
            if (colors := [item for value in raw if (item := _palette_item(value))])
        }
        if safe_palette:
            summary["palette"] = safe_palette

    raw_actions = resource.get("actions")
    if isinstance(raw_actions, list):
        actions = []
        for item in raw_actions:
            action = item.get("action") if isinstance(item, dict) else None
            if not isinstance(action, dict):
                continue
            safe_action: dict[str, Any] = {}
            on = action.get("on")
            if isinstance(on, dict) and isinstance(on.get("on"), bool):
                safe_action["on"] = {"on": on["on"]}
            dimming = action.get("dimming")
            if isinstance(dimming, dict) and _number(dimming.get("brightness")):
                safe_action["dimming"] = {"brightness": dimming["brightness"]}
            color = _xy(action.get("color"))
            temperature = _color_temperature(action)
            if color:
                safe_action["color"] = color
            if temperature:
                safe_action.update(temperature)
            actions.append({"action": safe_action})
        if actions:
            summary["actions"] = actions
    return summary


async def hue_scene_diagnostics(hass: HomeAssistant, entry_id: str) -> dict[str, Any]:
    """Read scene artwork through the existing Hue session, preserving resource IDs."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", entry_id):
        raise ValueError("invalid_hue_config_entry")
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != "hue":
        raise ValueError("hue_config_entry_not_found")
    bridge = getattr(entry, "runtime_data", None)
    if bridge is None:
        raise RuntimeError("hue_diagnostics_unavailable")
    if bridge.api_version == 1:
        return {"data": {"full_state": []}}
    # Upstream diagnostics redact the top-level scene and group IDs. Registry
    # matching needs those IDs, especially when several rooms use the same scene name.
    resources = await bridge.api.request("get", "clip/v2/resource")
    full_state = []
    if isinstance(resources, list):
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            if summary := _scene_resource(resource):
                full_state.append(summary)
    return {"data": {"full_state": full_state}}
