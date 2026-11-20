# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""HA entity attribute allowlist and ConfigSubentry compatibility helpers."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import inspect
import re
import sys
from types import MappingProxyType
from typing import Any

from homeassistant import config_entries
from homeassistant.core import HomeAssistant

ATTRIBUTES = {
    "friendly_name",
    "device_class",
    "unit_of_measurement",
    "state_class",
    "brightness",
    "color_temp_kelvin",
    "color_temp",
    "hs_color",
    "rgb_color",
    "xy_color",
    "supported_color_modes",
    "color_mode",
    "min_color_temp_kelvin",
    "max_color_temp_kelvin",
    "effect",
    "effect_list",
    "temperature",
    "current_temperature",
    "hvac_modes",
    "hvac_action",
    "fan_mode",
    "fan_modes",
    "swing_mode",
    "swing_modes",
    "humidity",
    "current_humidity",
    "min_temp",
    "max_temp",
    "event_type",
    "event_types",
    "options",
    "min",
    "max",
    "step",
    "battery_level",
    "supported_features",
    "icon",
    "position",
    "suggested_display_precision",
    "media_title",
    "media_artist",
    "media_album_name",
    "media_duration",
    "media_position",
    "app_name",
    "source",
    "source_list",
    "volume_level",
    "is_volume_muted",
}


def signature_parameters(target: Callable[..., object]) -> Mapping[str, inspect.Parameter]:
    """Inspect parameter names without resolving HA's type-only imports."""
    if sys.version_info >= (3, 14):
        from annotationlib import Format

        return inspect.signature(target, annotation_format=Format.STRING).parameters
    return inspect.signature(target).parameters


def config_subentries(raw: Any) -> dict[str, Any] | None:
    """Build HA ConfigSubentry objects without losing imported identifiers or data."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("invalid_config_subentries")
    subentry_type = getattr(config_entries, "ConfigSubentry", None)
    if raw and not callable(subentry_type):
        raise RuntimeError("ha_config_subentries_unsupported")
    result: dict[str, Any] = {}
    unique_ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("invalid_config_subentries")
        subentry_id = item.get("subentryId", item.get("subentry_id"))
        kind = item.get("subentryType", item.get("subentry_type"))
        title = item.get("title")
        data = item.get("data")
        unique_id = item.get("uniqueId", item.get("unique_id"))
        if (
            not isinstance(subentry_id, str)
            or re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", subentry_id) is None
            or not isinstance(kind, str)
            or re.fullmatch(r"[a-z0-9_]{1,128}", kind) is None
            or not isinstance(title, str)
            or not title.strip()
            or len(title) > 256
            or not isinstance(data, dict)
            or (unique_id is not None and (not isinstance(unique_id, str) or len(unique_id) > 1024))
            or subentry_id in result
            or (unique_id is not None and unique_id in unique_ids)
        ):
            raise ValueError("invalid_config_subentries")
        if not callable(subentry_type):
            raise RuntimeError("ha_config_subentries_unsupported")
        result[subentry_id] = subentry_type(
            data=MappingProxyType(dict(data)),
            subentry_id=subentry_id,
            subentry_type=kind,
            title=title,
            unique_id=unique_id,
        )
        if unique_id is not None:
            unique_ids.add(unique_id)
    return result


def apply_config_subentries(hass: HomeAssistant, entry: Any, raw: Any) -> None:
    """Replace an entry's subentries in one HA registry update when supported."""
    desired = config_subentries(raw)
    if desired is None or dict(getattr(entry, "subentries", {})) == desired:
        return
    updater = hass.config_entries.async_update_entry
    if "subentries" in signature_parameters(updater):
        updater(entry, subentries=desired)
        return
    internal_updater = getattr(hass.config_entries, "_async_update_entry", None)
    if callable(internal_updater) and "subentries" in signature_parameters(internal_updater):
        internal_updater(entry, subentries=desired)
        return
    if desired or getattr(entry, "subentries", {}):
        raise RuntimeError("ha_config_subentries_unsupported")
