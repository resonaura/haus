"""Physical camera spotlights. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.light import ColorMode, LightEntity

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "light", HausLight)


class HausLight(NativeEntity, LightEntity):
    @property
    def light_state(self):
        value = self.description.get("state")
        return value if isinstance(value, dict) else {}

    @property
    def is_on(self):
        return self.light_state.get("on", False)

    @property
    def supported_color_modes(self):
        entity = self.description or self._initial
        modes = set()
        if entity.get("color"):
            modes.add(ColorMode.HS)
        if entity.get("colorTemperature"):
            modes.add(ColorMode.COLOR_TEMP)
        return modes or {
            ColorMode.BRIGHTNESS if entity.get("brightness") else ColorMode.ONOFF
        }

    @property
    def color_mode(self):
        return (
            ColorMode.COLOR_TEMP
            if self.light_state.get("colorTemperature")
            else next(iter(sorted(self.supported_color_modes)))
        )

    @property
    def brightness(self):
        value = self.light_state.get("brightness")
        return round(value * 255 / 100) if value is not None else None

    @property
    def hs_color(self):
        value = self.light_state
        return (
            (value["hue"], value["saturation"])
            if "hue" in value and "saturation" in value
            else None
        )

    @property
    def color_temp_kelvin(self):
        return self.light_state.get("colorTemperature")

    @property
    def min_color_temp_kelvin(self):
        return (
            (self.description or self._initial)
            .get("colorTemperature", {})
            .get("minKelvin", 2000)
        )

    @property
    def max_color_temp_kelvin(self):
        return (
            (self.description or self._initial)
            .get("colorTemperature", {})
            .get("maxKelvin", 6500)
        )

    async def async_turn_on(self, **kwargs):
        value = {"on": True}
        if "brightness" in kwargs:
            value["brightness"] = round(kwargs["brightness"] * 100 / 255)
        if "hs_color" in kwargs:
            value["hue"], value["saturation"] = kwargs["hs_color"]
        if "color_temp_kelvin" in kwargs:
            value["colorTemperature"] = kwargs["color_temp_kelvin"]
        await self.send(value)

    async def async_turn_off(self, **kwargs):
        await self.send({"on": False})
