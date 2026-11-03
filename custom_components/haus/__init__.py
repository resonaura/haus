"""Optimized Haus camera views for HA. SPDX-License-Identifier: GPL-3.0-or-later."""

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client import HausAuthError, HausClient, HausConnectionError
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
NATIVE_PLATFORMS = [
    Platform.BINARY_SENSOR,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.LIGHT,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.BUTTON,
]


def platforms(entry):
    return [
        Platform.CAMERA,
        *(NATIVE_PLATFORMS if entry.data.get("native_entities") else []),
    ]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    client = HausClient(
        async_get_clientsession(hass), entry.data["url"], entry.data["token"]
    )

    async def update():
        try:
            cameras = await client.cameras()
            if entry.data.get("native_entities"):
                for device in await client.devices():
                    if device.get("cameraId") in cameras:
                        cameras[device["cameraId"]]["native_entities"] = device
            return cameras
        except HausAuthError as err:
            raise ConfigEntryAuthFailed(
                "The Haus camera connection was revoked"
            ) from err
        except HausConnectionError as err:
            raise UpdateFailed("Haus camera workers are unavailable") from err

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=DOMAIN,
        config_entry=entry,
        update_method=update,
        update_interval=timedelta(
            seconds=2 if entry.data.get("native_entities") else 10
        ),
    )
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
    }
    await hass.config_entries.async_forward_entry_setups(entry, platforms(entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if await hass.config_entries.async_unload_platforms(entry, platforms(entry)):
        hass.data[DOMAIN].pop(entry.entry_id, None)
        return True
    return False


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Revoke this camera capability when the integration is removed."""
    client = HausClient(
        async_get_clientsession(hass), entry.data["url"], entry.data["token"]
    )
    try:
        await client.request("POST", "/ha/revoke", {})
    except (HausAuthError, HausConnectionError):
        _LOGGER.warning(
            "Haus camera access could not be revoked while Helper is unavailable; revoke the client in Haus when it is reachable"
        )
