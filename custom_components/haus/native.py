"""Thin native entity adapter. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .client import HausAuthError, HausConnectionError
from .const import DOMAIN


async def setup_native(hass, entry, async_add_entities, domain, cls):
    runtime = hass.data[DOMAIN][entry.entry_id]
    coordinator = runtime["coordinator"]
    added = set()

    @callback
    def discover():
        entities = []
        for camera_id, camera in coordinator.data.items():
            device = camera.get("native_entities", {})
            for entity in device.get("entities", []):
                key = (camera_id, entity["id"])
                if entity.get("domain") != domain or key in added:
                    continue
                if domain not in ("sensor", "binary_sensor") and not entity.get(
                    "writable"
                ):
                    continue
                entities.append(
                    cls(
                        coordinator,
                        runtime["client"],
                        entry,
                        camera_id,
                        entity,
                        runtime["ready"],
                    )
                )
                added.add(key)
        if entities:
            async_add_entities(entities)

    discover()
    entry.async_on_unload(coordinator.async_add_listener(discover))


class NativeEntity(CoordinatorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, client, entry, camera_id, entity, ready=None):
        super().__init__(coordinator)
        self.client, self.camera_id, self.entity_key = client, camera_id, entity["id"]
        self._attr_unique_id = (
            f"haus_native:{entry.unique_id}:{camera_id}:{self.entity_key}"
        )
        self._attr_name = entity["name"]
        self._initial = entity
        self._native_ready = ready
        device = coordinator.data[camera_id]["native_entities"]
        registry = dr.async_get(coordinator.hass)
        source = er.async_get(coordinator.hass).async_get(camera_id)
        physical = registry.async_get(
            device.get("deviceId") or (source.device_id if source else "")
        )
        if physical and physical.identifiers:
            area = (
                ar.async_get(coordinator.hass).async_get_area(physical.area_id)
                if physical.area_id
                else None
            )
            # HA 2026.8 scopes identifiers per config entry. Create one complete
            # native Haus device, rather than assuming foreign identifiers merge.
            self._attr_device_info = dr.DeviceInfo(
                identifiers=physical.identifiers,
                name=physical.name_by_user or physical.name or device["name"],
                manufacturer=device["manufacturer"],
                model=device["model"],
                suggested_area=area.name if area else None,
            )
        else:
            self._attr_device_info = dr.DeviceInfo(
                identifiers={(DOMAIN, f"{device['bridgeId']}:{device['physicalId']}")},
                name=device["name"],
                manufacturer=device["manufacturer"],
                model=device["model"],
            )

    @property
    def description(self):
        camera = self.coordinator.data.get(self.camera_id, {})
        return next(
            (
                item
                for item in camera.get("native_entities", {}).get("entities", [])
                if item["id"] == self.entity_key
            ),
            {},
        )

    @property
    def available(self):
        return self.coordinator.last_update_success and self.description.get(
            "available", False
        )

    @property
    def capability_attributes(self):
        result = {"haus_camera": self.camera_id, "haus_entity_key": self.entity_key}
        if role := self.description.get("role"):
            result["haus_camera_role"] = role
        if self.entity_key == "haus_activity":
            result["haus_activity_version"] = 1
        return {**(super().capability_attributes or {}), **result}

    @property
    def extra_state_attributes(self):
        if self.entity_key == "haus_activity":
            return {"native_sources": self.description.get("nativeSources", [])}
        return None

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self._native_ready is not None:
            self._native_ready.add((self.camera_id, self.entity_key))

    async def async_will_remove_from_hass(self):
        if self._native_ready is not None:
            self._native_ready.discard((self.camera_id, self.entity_key))
        await super().async_will_remove_from_hass()

    async def send(self, value=None, press=False):
        if not self.available:
            raise HomeAssistantError("This camera control is unavailable")
        try:
            await self.client.command(
                self.camera_id,
                self.entity_key,
                {"action": "press"} if press else {"action": "set", "value": value},
            )
        except (HausAuthError, HausConnectionError) as err:
            raise HomeAssistantError("The camera did not confirm this command") from err
        await self.coordinator.async_request_refresh()
