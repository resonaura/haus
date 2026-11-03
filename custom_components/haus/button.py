"""Camera actions. SPDX-License-Identifier: GPL-3.0-or-later."""

from homeassistant.components.button import ButtonEntity

from .native import NativeEntity, setup_native


async def async_setup_entry(hass, entry, async_add_entities):
    await setup_native(hass, entry, async_add_entities, "button", HausButton)


class HausButton(NativeEntity, ButtonEntity):
    async def async_press(self):
        await self.send(press=True)
