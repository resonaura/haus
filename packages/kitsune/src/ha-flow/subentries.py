# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""HA entity attribute allowlist and ConfigSubentry compatibility helpers."""

from __future__ import annotations

import asyncio
import inspect
import re
import sys
from collections.abc import Awaitable, Callable, Mapping
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


_COLOR_KEYS = ("hs_color", "rgb_color", "xy_color", "rgbw_color", "rgbww_color")
_NON_COALESCE_LIGHT_KEYS = ("brightness_step", "brightness_step_pct", "flash")
_INFRASTRUCTURE_PARENT_RE = re.compile(
    r"\b(?:bridge|coordinator|gateway|router|mesh|eero|unifi|access\s*point|repeater|satellite)\b",
    re.IGNORECASE,
)
_SUBUNIT_NAME_RE = re.compile(
    r"\b(?:channel|outlet|socket|plug|usb|gang|relay|port)\b",
    re.IGNORECASE,
)
_CHANNEL_SEP = ("_", ":", "-", "/")


def _has_subchannel_identifier(child: Any, parent: Any) -> bool:
    """True when a child device identifier extends a parent identifier with a channel suffix."""
    child_ids = getattr(child, "identifiers", None) or ()
    parent_ids = getattr(parent, "identifiers", None) or ()
    for p_entry in parent_ids:
        if not isinstance(p_entry, (tuple, list)) or len(p_entry) != 2:
            continue
        domain, pid = p_entry
        if not isinstance(pid, str) or not pid:
            continue
        for c_entry in child_ids:
            if not isinstance(c_entry, (tuple, list)) or len(c_entry) != 2:
                continue
            c_domain, cid = c_entry
            if c_domain != domain or not isinstance(cid, str) or len(cid) <= len(pid) + 1:
                continue
            if cid.startswith(pid) and cid[len(pid)] in _CHANNEL_SEP:
                return True
    return False


def _device_entry_ids(device: Any) -> set[str]:
    """Read config entry IDs without touching HA 2026's deprecated DeviceEntry properties."""
    entry_id = getattr(device, "config_entry_id", None)
    if isinstance(entry_id, str) and entry_id:
        return {entry_id}
    entries: set[str] = set()
    for attr in ("primary_config_entry", "config_entries"):
        try:
            val = getattr(device, attr, None)
        except Exception:
            continue
        if isinstance(val, str) and val:
            entries.add(val)
        elif val:
            entries.update(item for item in val if isinstance(item, str) and item)
    return entries


def _is_composite_hardware_subdevice(child: Any, parent: Any) -> bool:
    """True when `child` is a sub-unit (e.g. power-strip outlet channel) of `parent`'s enclosure."""
    if parent is None or getattr(parent, "id", None) == getattr(child, "id", None):
        return False
    if getattr(parent, "entry_type", None) is not None:
        return False
    child_entries = _device_entry_ids(child)
    parent_entries = _device_entry_ids(parent)
    if child_entries and parent_entries and not (child_entries & parent_entries):
        return False

    parent_desc = f"{getattr(parent, 'model', '') or ''} {getattr(parent, 'name', '') or ''}"
    if _INFRASTRUCTURE_PARENT_RE.search(parent_desc):
        return False

    c_mfg = (getattr(child, "manufacturer", None) or "").strip().lower()
    p_mfg = (getattr(parent, "manufacturer", None) or "").strip().lower()
    if c_mfg and p_mfg and c_mfg != p_mfg:
        return False

    if _has_subchannel_identifier(child, parent):
        return True

    c_model = (getattr(child, "model", None) or "").strip().lower()
    p_model = (getattr(parent, "model", None) or "").strip().lower()
    if c_model and p_model and c_model == p_model:
        child_label = f"{getattr(child, 'name', '') or ''} {getattr(child, 'name_by_user', '') or ''}"
        if _SUBUNIT_NAME_RE.search(child_label):
            return True
    return False


def resolve_canonical_device(device: Any, devices: Any) -> Any:
    """Fold hardware-composite sub-devices (power strip outlets/channels) onto their physical parent."""
    if device is None:
        return None
    current = device
    seen: set[str] = set()
    while current is not None:
        cur_id = getattr(current, "id", None)
        if isinstance(cur_id, str):
            if cur_id in seen:
                break
            seen.add(cur_id)
        via_id = getattr(current, "via_device_id", None)
        if not via_id:
            break
        parent = devices.async_get(via_id)
        if not _is_composite_hardware_subdevice(current, parent):
            break
        current = parent
    return current


def normalize_light_call_data(call_data: dict[str, Any]) -> dict[str, Any]:
    """Normalize kelvin alias and resolve mutually exclusive HA color keys."""
    if "kelvin" in call_data and "color_temp_kelvin" not in call_data:
        call_data["color_temp_kelvin"] = call_data.pop("kelvin")
    if "color_temp_kelvin" in call_data:
        for key in _COLOR_KEYS:
            call_data.pop(key, None)
    return call_data


class EntityCommandQueue:
    """Per-entity FIFO queue with latest-wins coalescing for idempotent light commands."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._pending: dict[str, dict[str, Any]] = {}

    async def run(
        self,
        domain: str,
        entity_id: str,
        service: str,
        call_data: dict[str, Any],
        dispatch: Callable[[str, str, dict[str, Any]], Awaitable[None]],
    ) -> None:
        lock = self._locks.setdefault(entity_id, asyncio.Lock())
        coalesceable = (
            domain == "light"
            and service in ("turn_on", "turn_off")
            and not any(key in call_data for key in _NON_COALESCE_LIGHT_KEYS)
        )
        if not coalesceable:
            if (pending := self._pending.get(entity_id)) is not None:
                pending["sealed"] = True
            async with lock:
                await dispatch(domain, service, call_data)
            return
        if not lock.locked():
            async with lock:
                await dispatch(domain, service, call_data)
            return
        pending = self._pending.get(entity_id)
        if pending is not None and not pending.get("sealed"):
            if service == "turn_off" or pending["service"] == "turn_off":
                pending["service"] = service
                pending["data"] = dict(call_data)
            else:
                if "color_temp_kelvin" in call_data:
                    for key in _COLOR_KEYS:
                        pending["data"].pop(key, None)
                elif any(key in call_data for key in _COLOR_KEYS):
                    pending["data"].pop("color_temp_kelvin", None)
                pending["data"].update(call_data)
            await asyncio.shield(pending["future"])
            return
        slot: dict[str, Any] = {
            "service": service,
            "data": dict(call_data),
            "future": asyncio.get_running_loop().create_future(),
            "sealed": False,
        }
        self._pending[entity_id] = slot
        async with lock:
            if self._pending.get(entity_id) is slot:
                self._pending.pop(entity_id, None)
            try:
                await dispatch(domain, slot["service"], slot["data"])
            except BaseException as err:
                if not slot["future"].done():
                    slot["future"].set_exception(err)
                raise
            if not slot["future"].done():
                slot["future"].set_result(True)
