# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Execute configured integrations and expose their live entity registry to Haus."""

from __future__ import annotations

from collections import deque
import asyncio
import inspect
import re
import sys
from collections.abc import Callable, Mapping
from types import MappingProxyType
from typing import Any

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component

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


class IntegrationEntities:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.events: deque[dict[str, Any]] = deque(maxlen=2048)
        self.sequence = 0
        self.setups: dict[str, asyncio.Task[dict[str, Any]]] = {}
        hass.bus.async_listen("state_changed", self._state_changed)

    @callback
    def _state_changed(self, event: Any) -> None:
        state = event.data.get("new_state")
        if state is None or event.data.get("old_state") is None or not state.entity_id.startswith("event."):
            return
        event_type = state.attributes.get("event_type")
        if not isinstance(event_type, str):
            return
        self.sequence += 1
        self.events.append(
            {
                "sequence": self.sequence,
                "entityId": state.entity_id,
                "eventType": event_type,
                "at": state.last_updated.isoformat(),
            }
        )

    async def setup(self, entry_id: str) -> dict[str, Any]:
        task = self.setups.get(entry_id)
        if task is None:
            task = asyncio.create_task(self._setup(entry_id), name=f"haus setup {entry_id}")
            self.setups[entry_id] = task
        # A slow device must not block configuration/discovery for every other integration.
        await asyncio.wait({task}, timeout=0.05)
        if task.done():
            try:
                return task.result()
            finally:
                self.setups.pop(entry_id, None)
        return {"ok": False, "state": "setup_in_progress"}

    async def unload(self, entry_id: str) -> dict[str, bool]:
        task = self.setups.pop(entry_id, None)
        if task is not None:
            await task
        if self.hass.config_entries.async_get_entry(entry_id) is None:
            return {"ok": True}
        return {"ok": bool(await self.hass.config_entries.async_unload(entry_id))}

    async def _setup(self, entry_id: str) -> dict[str, Any]:
        entry = self.hass.config_entries.async_get_entry(entry_id)
        if entry is None:
            raise ValueError("unknown_integration_entry")
        if entry.disabled_by is not None:
            return {"ok": False, "state": str(entry.state.value)}
        if entry.state.value == "loaded":
            return {"ok": True, "state": "loaded"}
        if not await async_setup_component(self.hass, entry.domain, {}):
            return {"ok": False, "state": "setup_error"}
        if entry.state.value == "loaded":
            return {"ok": True, "state": "loaded"}
        if entry.state.value != "not_loaded":
            return {"ok": False, "state": str(entry.state.value)}
        setup = self.hass.data.get("_haus_orig_async_setup") or self.hass.config_entries.async_setup
        ok = await setup(entry_id)
        return {"ok": bool(ok), "state": str(entry.state.value)}

    async def import_entry(
        self,
        raw: dict[str, Any],
        entities: list[dict[str, Any]],
        devices: list[dict[str, Any]],
        areas: list[dict[str, Any]],
    ) -> dict[str, str]:
        entry_id, domain = str(raw["entryId"]), str(raw["domain"])
        disabled_by_raw = raw.get("disabledBy")
        disabled_by = (
            config_entries.ConfigEntryDisabler(disabled_by_raw)
            if disabled_by_raw in {value.value for value in config_entries.ConfigEntryDisabler}
            else None
        )
        entry = self.hass.config_entries.async_get_entry(entry_id)
        if entry is not None and entry.domain != domain:
            raise ValueError("integration_entry_conflict")
        desired_subentries = config_subentries(raw.get("subentries")) if "subentries" in raw else None
        if entry is not None and (
            entry.title != str(raw["title"])
            or dict(entry.data) != dict(raw["data"])
            or dict(entry.options) != dict(raw.get("options") or {})
            or entry.unique_id != raw.get("uniqueId")
            or entry.version != int(raw.get("version", 1))
            or entry.minor_version != int(raw.get("minorVersion", 1))
            or entry.disabled_by != disabled_by
            or (desired_subentries is not None and dict(entry.subentries) != desired_subentries)
        ):
            raise ValueError("integration_entry_conflict")

        known_subentries = (
            desired_subentries
            if desired_subentries is not None
            else (dict(entry.subentries) if entry is not None else {})
        )
        subentry_ids = set(known_subentries)
        for item in [*entities, *devices]:
            subentry_id = item.get("config_subentry_id")
            if subentry_id is not None and subentry_id not in subentry_ids:
                raise ValueError("integration_entity_conflict")

        entity_registry = er.async_get(self.hass)
        for item in entities:
            entity_id = str(item["entity_id"])
            entity_domain = entity_id.split(".", 1)[0]
            unique_id = str(item["unique_id"])
            existing = entity_registry.async_get(entity_id)
            unique_entity_id = entity_registry.async_get_entity_id(entity_domain, str(item["platform"]), unique_id)
            if existing is not None and (
                existing.config_entry_id != entry_id
                or existing.platform != item["platform"]
                or existing.unique_id != unique_id
            ):
                raise ValueError("integration_entity_conflict")
            if unique_entity_id is not None:
                registered = entity_registry.async_get(unique_entity_id)
                if registered is None or registered.config_entry_id != entry_id:
                    raise ValueError("integration_entity_conflict")

        area_registry = ar.async_get(self.hass)
        area_map: dict[str, str] = {}
        for item in areas:
            source_id = str(item["id"])
            name = str(item["name"]).strip()
            area = area_registry.async_get_area_by_name(name)
            if area is None:
                area = area_registry.async_create(name)
            area_map[source_id] = area.id

        if entry is None:
            constructor_parameters = signature_parameters(config_entries.ConfigEntry)
            subentries_data = [
                {
                    "subentry_id": subentry.subentry_id,
                    "subentry_type": subentry.subentry_type,
                    "title": subentry.title,
                    "data": dict(subentry.data),
                    "unique_id": subentry.unique_id,
                }
                for subentry in (desired_subentries or {}).values()
            ]
            if subentries_data and "subentries_data" not in constructor_parameters:
                raise RuntimeError("ha_config_subentries_unsupported")
            entry = config_entries.ConfigEntry(
                **({"subentries_data": subentries_data} if "subentries_data" in constructor_parameters else {}),
                entry_id=entry_id,
                domain=domain,
                title=str(raw["title"]),
                data=dict(raw["data"]),
                options=dict(raw.get("options") or {}),
                unique_id=raw.get("uniqueId"),
                version=int(raw.get("version", 1)),
                minor_version=int(raw.get("minorVersion", 1)),
                source="import",
                disabled_by=disabled_by,
                discovery_keys=MappingProxyType({}),
            )
            await self.hass.config_entries.async_add(entry)
        device_map = {}
        registry = dr.async_get(self.hass)
        for item in devices:
            source_area_id = item.get("area_id")
            area_id = area_map.get(str(source_area_id)) if source_area_id else None
            area = area_registry.async_get_area(area_id) if area_id else None
            device_parameters = signature_parameters(registry.async_get_or_create)
            device_options = {
                "config_entry_id": entry_id,
                "identifiers": {tuple(v) for v in item.get("identifiers", [])},
                "connections": {tuple(v) for v in item.get("connections", [])},
                "name": item.get("name_by_user") or item.get("name"),
                "manufacturer": item.get("manufacturer"),
                "model": item.get("model"),
                "sw_version": item.get("sw_version"),
                "hw_version": item.get("hw_version"),
                "configuration_url": item.get("configuration_url"),
                "suggested_area": area.name if area else None,
            }
            if "config_subentry_id" in item:
                if "config_subentry_id" not in device_parameters and item["config_subentry_id"]:
                    raise RuntimeError("ha_config_subentries_unsupported")
                if "config_subentry_id" in device_parameters:
                    device_options["config_subentry_id"] = item["config_subentry_id"]
            device = registry.async_get_or_create(**device_options)
            if area_id:
                registry.async_update_device(device.id, area_id=area_id)
            device_map[str(item["id"])] = device.id
        for item in entities:
            entity_id = str(item["entity_id"])
            entity_parameters = signature_parameters(entity_registry.async_get_or_create)
            entity_options = {
                "config_entry": entry,
                "suggested_object_id": entity_id.split(".", 1)[1],
                "device_id": device_map.get(str(item.get("device_id"))),
                "original_name": item.get("original_name"),
            }
            if "config_subentry_id" in item:
                if "config_subentry_id" not in entity_parameters and item["config_subentry_id"]:
                    raise RuntimeError("ha_config_subentries_unsupported")
                if "config_subentry_id" in entity_parameters:
                    entity_options["config_subentry_id"] = item["config_subentry_id"]
            entity = entity_registry.async_get_or_create(
                entity_id.split(".", 1)[0],
                str(item["platform"]),
                str(item["unique_id"]),
                **entity_options,
            )
            if entity.entity_id != entity_id:
                entity_registry.async_update_entity(entity.entity_id, new_entity_id=entity_id)
            area_id = area_map.get(str(item.get("area_id"))) if item.get("area_id") else None
            updates: dict[str, Any] = {}
            for field in (
                "name",
                "icon",
                "device_class",
                "original_device_class",
                "original_icon",
                "unit_of_measurement",
                "entity_category",
                "translation_key",
                "has_entity_name",
                "supported_features",
            ):
                if field in item:
                    updates[field] = item[field]
            entity_category = item.get("entity_category")
            if entity_category is not None:
                updates["entity_category"] = er.EntityCategory(entity_category)
            if area_id:
                updates["area_id"] = area_id
            disabled_by = item.get("disabled_by")
            if disabled_by is not None:
                updates["disabled_by"] = er.RegistryEntryDisabler(disabled_by)
            if updates:
                entity_registry.async_update_entity(entity_id, **updates)
        return {"entryId": entry.entry_id, "domain": entry.domain}

    def snapshot(self, since: int = 0) -> dict[str, Any]:
        entities = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        rows = []
        for state in self.hass.states.async_all():
            entity = entities.async_get(state.entity_id)
            if entity is None or not entity.config_entry_id:
                continue
            device = devices.async_get(entity.device_id) if entity.device_id else None
            entry = self.hass.config_entries.async_get_entry(entity.config_entry_id)
            if entry is None or entry.state.value != "loaded":
                continue
            rows.append(
                {
                    "entityId": state.entity_id,
                    "entryId": entity.config_entry_id,
                    "integration": entry.domain if entry else "",
                    "uniqueId": entity.unique_id,
                    "name": str(
                        entity.name or state.attributes.get("friendly_name") or entity.original_name or state.entity_id
                    ),
                    "domain": state.domain,
                    "state": state.state,
                    "attributes": {key: value for key, value in state.attributes.items() if key in ATTRIBUTES},
                    "entityCategory": entity.entity_category.value if entity.entity_category else None,
                    "deviceId": device.id if device else state.entity_id,
                    "deviceName": (device.name_by_user or device.name) if device else None,
                    "deviceEntryType": device.entry_type.value if device and device.entry_type else None,
                    "manufacturer": device.manufacturer if device else None,
                    "model": device.model if device else None,
                    "areaId": (entity.area_id or (device.area_id if device else None)),
                    "areaName": (
                        area.name
                        if (
                            area := ar.async_get(self.hass).async_get_area(
                                entity.area_id or (device.area_id if device else None)
                            )
                        )
                        else None
                    ),
                }
            )
        return {
            "entities": rows,
            "entries": [
                {
                    "entryId": entry.entry_id,
                    "state": str(entry.state.value),
                    "config": {
                        "entryId": entry.entry_id,
                        "domain": entry.domain,
                        "title": entry.title,
                        "data": dict(entry.data),
                        "options": dict(entry.options),
                        "uniqueId": entry.unique_id,
                        "version": entry.version,
                        "minorVersion": entry.minor_version,
                        **(
                            {
                                "subentries": [
                                    {
                                        "subentryId": item.subentry_id,
                                        "subentryType": item.subentry_type,
                                        "title": item.title,
                                        "data": dict(item.data),
                                        "uniqueId": item.unique_id,
                                    }
                                    for item in entry.subentries.values()
                                ]
                            }
                            if entry.subentries
                            else {}
                        ),
                    },
                }
                for entry in self.hass.config_entries.async_entries()
            ],
            "events": [event for event in self.events if event["sequence"] > since],
            "sequence": self.sequence,
        }

    async def command(self, entry_id: str, entity_id: str, service: str, data: dict[str, Any]) -> dict[str, bool]:
        entity = er.async_get(self.hass).async_get(entity_id)
        if entity is None or entity.config_entry_id != entry_id:
            raise ValueError("integration_entity_unavailable")
        domain = entity_id.split(".", 1)[0]
        await self.hass.services.async_call(domain, service, {**data, "entity_id": entity_id}, blocking=True)
        return {"ok": True}
