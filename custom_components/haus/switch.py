"""Camera switches. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.switch import SwitchEntity

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "switch", HausSwitch)


class HausSwitch(NativeEntity, SwitchEntity):
    @property
    def is_on(self):
        return self.description.get("state") is True

    async def async_turn_on(self, **kwargs):
        await self.send(True)

    async def async_turn_off(self, **kwargs):
        await self.send(False)
