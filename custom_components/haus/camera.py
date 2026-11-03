"""Native Haus WebRTC and cached images. SPDX-License-Identifier: GPL-3.0-or-later."""

import asyncio
from datetime import timedelta
from uuid import uuid4

from homeassistant.components.camera import (
    Camera,
    CameraEntityFeature,
    WebRTCAnswer,
    WebRTCError,
)
from homeassistant.core import callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .client import HausAuthError, HausConnectionError
from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    runtime = hass.data[DOMAIN][entry.entry_id]
    coordinator = runtime["coordinator"]
    added = set()

    @callback
    def discover():
        entities = []
        registry = er.async_get(hass)
        devices = dr.async_get(hass)
        for source_id in coordinator.data:
            if source_id in added:
                continue
            added.add(source_id)
            source = registry.async_get(source_id)
            device = (
                devices.async_get(source.device_id)
                if source and source.device_id
                else None
            )
            if device is None and coordinator.data[source_id].get("deviceId"):
                device = devices.async_get(coordinator.data[source_id]["deviceId"])
            entities.append(
                HausCamera(coordinator, runtime["client"], entry, source_id, device)
            )
        if entities:
            async_add_entities(entities)

    discover()
    entry.async_on_unload(coordinator.async_add_listener(discover))


class HausCamera(CoordinatorEntity, Camera):
    """Presentation-only camera; the source entity is never read for images or video."""

    _attr_supported_features = CameraEntityFeature.STREAM
    _attr_content_type = "image/jpeg"

    def __init__(self, coordinator, client, entry, source_id, device):
        CoordinatorEntity.__init__(self, coordinator)
        Camera.__init__(self)
        self.client = client
        self.source_id = source_id
        self._attr_unique_id = f"haus_camera:{entry.unique_id}:{source_id}"
        if device and device.identifiers:
            self._attr_device_info = dr.DeviceInfo(identifiers=device.identifiers)
        elif native := coordinator.data[source_id].get("native"):
            self._attr_device_info = dr.DeviceInfo(
                identifiers={(DOMAIN, f"{native['bridgeId']}:{native['physicalId']}")},
                manufacturer=native.get("manufacturer"), model=native.get("model"),
                name=coordinator.data[source_id].get("name"),
            )
        self._sessions = {}
        self._last_image = None

    @property
    def name(self):
        source = self.coordinator.data.get(self.source_id, {})
        name = source.get("name", self.source_id)
        return name if source.get("native", {}).get("primary") else f"{name} · Haus"

    @property
    def extra_state_attributes(self):
        native = self.coordinator.data.get(self.source_id, {}).get("native", {})
        return {
            "haus_camera_proxy": 0 if native.get("primary") else 1,
            "haus_native_camera": 1 if native else 0,
            "haus_source_camera": self.source_id,
        }

    @property
    def available(self):
        return self.coordinator.last_update_success and self.coordinator.data.get(
            self.source_id, {}
        ).get("available", False)

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(
            async_track_time_interval(self.hass, self._keepalive, timedelta(seconds=20))
        )

    async def async_will_remove_from_hass(self):
        states = list(self._sessions.values())
        self._sessions.clear()
        await asyncio.gather(
            *(self._close(state) for state in states), return_exceptions=True
        )
        await super().async_will_remove_from_hass()

    async def async_camera_image(self, width=None, height=None):
        try:
            self._last_image = await self.client.camera(self.source_id, "snapshot")
        except (HausConnectionError, HausAuthError):
            if self._last_image is None:
                raise
        return self._last_image

    async def async_handle_async_webrtc_offer(
        self, offer_sdp, session_id, send_message
    ):
        state = {
            "sessionId": str(uuid4()),
            "ready": False,
            "candidates": [],
            "send": send_message,
        }
        self._sessions[session_id] = state
        try:
            result = await self.client.camera(
                self.source_id,
                "viewer",
                {"sessionId": state["sessionId"], "offer": offer_sdp},
            )
            if self._sessions.get(session_id) is not state:
                await self._close(state)
                return
            answer = result.get("answer", {})
            if answer.get("type") != "answer" or not isinstance(answer.get("sdp"), str):
                raise HausConnectionError
            state["ready"] = True
            send_message(WebRTCAnswer(answer["sdp"]))
            for candidate in state["candidates"]:
                await self.client.camera(
                    self.source_id,
                    "candidate",
                    {"sessionId": state["sessionId"], "candidate": candidate},
                )
            state["candidates"].clear()
        except (HausConnectionError, HausAuthError):
            self._sessions.pop(session_id, None)
            await self._close(state)
            send_message(
                WebRTCError(
                    "stream_unavailable",
                    "The Haus camera worker is unavailable. Try again shortly.",
                )
            )

    async def async_on_webrtc_candidate(self, session_id, candidate):
        state = self._sessions.get(session_id)
        value = candidate.to_dict()
        if not state or not value.get("candidate"):
            return
        if not state["ready"]:
            if len(state["candidates"]) < 128:
                state["candidates"].append(value)
            return
        await self.client.camera(
            self.source_id,
            "candidate",
            {"sessionId": state["sessionId"], "candidate": value},
        )

    @callback
    def close_webrtc_session(self, session_id):
        if state := self._sessions.pop(session_id, None):
            self.hass.async_create_task(self._close(state))

    async def _close(self, state):
        try:
            await self.client.camera(
                self.source_id, "close", {"sessionId": state["sessionId"]}
            )
        except (HausConnectionError, HausAuthError):
            pass  # The Helper expires an unreachable viewer after 60 seconds.

    async def _keepalive(self, _now):
        for key, state in list(self._sessions.items()):
            if not state["ready"]:
                continue
            try:
                await self.client.camera(
                    self.source_id, "lease", {"sessionId": state["sessionId"]}
                )
            except (HausConnectionError, HausAuthError):
                self._sessions.pop(key, None)
                state["send"](
                    WebRTCError(
                        "connection_lost",
                        "The camera worker disconnected. Reopen the camera to reconnect.",
                    )
                )
                await self._close(state)
