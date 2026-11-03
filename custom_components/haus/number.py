"""Camera ranges. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.number import NumberEntity, NumberMode

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "number", HausNumber)


class HausNumber(NativeEntity, NumberEntity):
    _attr_mode = NumberMode.SLIDER

    @property
    def native_value(self):
        return self.description.get("state")

    @property
    def native_min_value(self):
        return self.description.get("min", self._initial["min"])

    @property
    def native_max_value(self):
        return self.description.get("max", self._initial["max"])

    @property
    def native_step(self):
        return self.description.get("step", self._initial["step"])

    @property
    def native_unit_of_measurement(self):
        return self.description.get("unit")

    async def async_set_native_value(self, value):
        await self.send(value)
