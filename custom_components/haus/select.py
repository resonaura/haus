"""Camera modes. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.select import SelectEntity

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "select", HausSelect)


class HausSelect(NativeEntity, SelectEntity):
    @property
    def options(self):
        return self.description.get("options", self._initial["options"])

    @property
    def current_option(self):
        return self.description.get("state")

    async def async_select_option(self, option):
        await self.send(option)
