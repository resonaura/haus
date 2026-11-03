"""Camera readings. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "sensor", HausSensor)


class HausSensor(NativeEntity, SensorEntity):
    @property
    def native_value(self):
        return self.description.get("state")

    @property
    def native_unit_of_measurement(self):
        return self.description.get("unit")

    @property
    def device_class(self):
        value = self.description.get("deviceClass")
        return SensorDeviceClass(value) if value in SensorDeviceClass else None
