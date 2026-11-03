"""Explicit enrollment with the Helper. SPDX-License-Identifier: GPL-3.0-or-later."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .client import HausAuthError, HausClient, HausConnectionError, normalize_url
from .const import DEFAULT_URL, DOMAIN


class HausConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create only cameras authorized by an explicit one-time setup code."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                url = normalize_url(user_input["url"])
                await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()
                client = HausClient(async_get_clientsession(self.hass), url)
                enrollment = await client.enroll(user_input["code"])
                return self.async_create_entry(
                    title="Haus",
                    data={
                        "url": url,
                        "token": enrollment["token"],
                        "client_id": enrollment["clientId"],
                        "native_entities": enrollment.get("nativeEntities", False),
                    },
                )
            except HausAuthError:
                errors["base"] = "invalid_auth"
            except (HausConnectionError, ValueError):
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("url", default=DEFAULT_URL): str,
                    vol.Required("code"): str,
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data):
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        entry = self._get_reauth_entry()
        errors = {}
        if user_input is not None:
            try:
                client = HausClient(
                    async_get_clientsession(self.hass), entry.data["url"]
                )
                enrollment = await client.enroll(user_input["code"])
                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={
                        "token": enrollment["token"],
                        "client_id": enrollment["clientId"],
                        "native_entities": enrollment.get("nativeEntities", False),
                    },
                )
            except HausAuthError:
                errors["base"] = "invalid_auth"
            except HausConnectionError:
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required("code"): str}),
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input=None):
        entry = self._get_reconfigure_entry()
        errors = {}
        if user_input is not None:
            try:
                client = HausClient(
                    async_get_clientsession(self.hass), entry.data["url"]
                )
                enrollment = await client.enroll(user_input["code"])
                # Keep entry.unique_id unchanged: camera and control identities survive scope upgrades.
                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={
                        "token": enrollment["token"],
                        "client_id": enrollment["clientId"],
                        "native_entities": enrollment.get("nativeEntities", False),
                    },
                )
            except HausAuthError:
                errors["base"] = "invalid_auth"
            except HausConnectionError:
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=vol.Schema({vol.Required("code"): str}),
            errors=errors,
        )
