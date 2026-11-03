"""Camera activity. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(
        hass, entry, async_add_entities, "binary_sensor", HausBinarySensor
    )


class HausBinarySensor(NativeEntity, BinarySensorEntity):
    @property
    def is_on(self):
        return self.description.get("state") is True

    @property
    def device_class(self):
        value = self.description.get("deviceClass")
        return (
            BinarySensorDeviceClass(value) if value in BinarySensorDeviceClass else None
        )
