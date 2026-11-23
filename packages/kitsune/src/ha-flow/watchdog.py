# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Hue v2 EventStream hardening and self-healing watchdog for headless HA flow."""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import Callable
from contextlib import suppress
from typing import Any

_LOGGER = logging.getLogger(__name__)

HUE_KEEPALIVE_INTERVAL_SEC = 20
HUE_CONNECTION_TIMEOUT_SEC = 35
WATCHDOG_CHECK_INTERVAL_SEC = 15.0
DISCONNECT_RELOAD_AFTER_SEC = 40.0
SILENT_STREAM_RELOAD_AFTER_SEC = 75.0
RELOAD_COOLDOWN_SEC = 30.0


def harden_hue_eventstream() -> bool:
    """Tune aiohue SSE liveness timings and isolate subscriber errors in EventStream.emit."""
    try:
        from aiohue.v2.controllers import events as hue_events
        from aiohue.v2.models.resource import ResourceTypes
    except Exception:
        return False

    if getattr(hue_events, "KEEPALIVE_INTERVAL", 60) > HUE_KEEPALIVE_INTERVAL_SEC:
        hue_events.KEEPALIVE_INTERVAL = HUE_KEEPALIVE_INTERVAL_SEC
    if getattr(hue_events, "CONNECTION_TIMEOUT", 90) > HUE_CONNECTION_TIMEOUT_SEC:
        hue_events.CONNECTION_TIMEOUT = HUE_CONNECTION_TIMEOUT_SEC

    stream_cls = getattr(hue_events, "EventStream", None)
    if stream_cls is None or getattr(stream_cls.emit, "_haus_safe_emit", False):
        return True

    def _safe_emit(self: Any, event_type: Any, data: dict[str, Any] | None = None) -> None:
        for callback, event_filter, resource_filter in list(getattr(self, "_subscribers", ())):
            if event_filter is not None and event_type not in event_filter:
                continue
            if (
                data is not None
                and resource_filter is not None
                and ResourceTypes(data.get("type")) not in resource_filter
            ):
                continue
            try:
                if inspect.iscoroutinefunction(callback):
                    asyncio.create_task(callback(event_type, data))
                else:
                    callback(event_type, data)
            except Exception:
                logger = getattr(self, "_logger", _LOGGER)
                logger.exception(
                    "Hue EventStream subscriber failed for %s (%s); keeping stream alive",
                    event_type,
                    data.get("type") if isinstance(data, dict) else None,
                )

    setattr(_safe_emit, "_haus_safe_emit", True)
    stream_cls.emit = _safe_emit  # type: ignore[method-assign]
    return True


async def close_hue_api(entry: Any) -> None:
    """Explicitly close a Hue bridge API session so old SSE sockets do not leak on reload/unload."""
    if entry is None or getattr(entry, "domain", None) != "hue":
        return
    bridge = getattr(entry, "runtime_data", None)
    api = getattr(bridge, "api", None)
    close_fn = getattr(api, "close", None)
    if callable(close_fn):
        with suppress(Exception):
            result = close_fn()
            if inspect.isawaitable(result):
                await result


class HueEventWatchdog:
    """Supervises loaded Hue v2 EventStreams and reloads wedged bridges automatically."""

    def __init__(
        self,
        hass: Any,
        *,
        on_reloaded: Callable[[str], None] | None = None,
        check_interval_sec: float = WATCHDOG_CHECK_INTERVAL_SEC,
        disconnect_timeout_sec: float = DISCONNECT_RELOAD_AFTER_SEC,
        silent_stream_timeout_sec: float = SILENT_STREAM_RELOAD_AFTER_SEC,
        reload_cooldown_sec: float = RELOAD_COOLDOWN_SEC,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._hass = hass
        self._on_reloaded = on_reloaded
        self._check_interval = check_interval_sec
        self._disconnect_timeout = disconnect_timeout_sec
        self._silent_timeout = silent_stream_timeout_sec
        self._reload_cooldown = reload_cooldown_sec
        self._clock = clock
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        self._stream_ids: dict[str, int] = {}
        self._unsubs: dict[str, Callable[[], Any]] = {}
        self._last_activity: dict[str, float] = {}
        self._disconnected_since: dict[str, float] = {}
        self._stalled_queue_ticks: dict[str, int] = {}
        self._last_reload: dict[str, float] = {}

    def ensure_started(self) -> None:
        if self._closed or (self._task is not None and not self._task.done()):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._task = loop.create_task(self._loop(), name="haus hue eventstream watchdog")

    def forget(self, entry_id: str) -> None:
        unsub = self._unsubs.pop(entry_id, None)
        if callable(unsub):
            with suppress(Exception):
                unsub()
        self._stream_ids.pop(entry_id, None)
        self._last_activity.pop(entry_id, None)
        self._disconnected_since.pop(entry_id, None)
        self._stalled_queue_ticks.pop(entry_id, None)

    def close(self) -> None:
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            self._task = None
        for entry_id in list(self._unsubs):
            self.forget(entry_id)

    async def _loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._check_interval)
            if self._closed:
                return
            try:
                await self.check_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception("Hue EventStream watchdog tick failed")

    def _attach_stream(self, entry_id: str, events: Any, now: float) -> None:
        stream_id = id(events)
        if self._stream_ids.get(entry_id) == stream_id:
            return
        self.forget(entry_id)
        self._stream_ids[entry_id] = stream_id
        self._last_activity[entry_id] = now
        subscribe = getattr(events, "subscribe", None)
        if callable(subscribe):
            def _mark_active(_event_type: Any, _data: Any = None) -> None:
                self._last_activity[entry_id] = self._clock()

            with suppress(Exception):
                self._unsubs[entry_id] = subscribe(_mark_active)

    def _diagnose(self, entry_id: str, events: Any, now: float) -> str | None:
        bg_tasks = getattr(events, "_bg_tasks", None)
        if isinstance(bg_tasks, (list, tuple)):
            if not bg_tasks or any(getattr(task, "done", lambda: False)() for task in bg_tasks):
                return "dead_background_task"

        queue = getattr(events, "_event_queue", None)
        qsize = queue.qsize() if queue is not None and callable(getattr(queue, "qsize", None)) else 0
        if qsize > 0:
            ticks = self._stalled_queue_ticks.get(entry_id, 0) + 1
            self._stalled_queue_ticks[entry_id] = ticks
            if ticks >= 2:
                return f"stalled_event_queue({qsize})"
        else:
            self._stalled_queue_ticks.pop(entry_id, None)

        if bool(getattr(events, "connected", False)):
            self._disconnected_since.pop(entry_id, None)
        else:
            since = self._disconnected_since.setdefault(entry_id, now)
            if now - since >= self._disconnect_timeout:
                return f"disconnected_{int(now - since)}s"

        last_seen = self._last_activity.get(entry_id, now)
        if now - last_seen >= self._silent_timeout:
            return f"silent_stream_{int(now - last_seen)}s"
        return None

    async def check_once(self) -> list[str]:
        """Inspect loaded Hue v2 bridges and reload any entry with a wedged EventStream."""
        reloaded: list[str] = []
        now = self._clock()
        seen_ids: set[str] = set()
        for entry in self._hass.config_entries.async_entries("hue"):
            entry_id = entry.entry_id
            if getattr(entry.state, "value", None) != "loaded":
                continue
            bridge = getattr(entry, "runtime_data", None)
            api = getattr(bridge, "api", None)
            events = getattr(api, "events", None)
            if events is None:
                continue
            seen_ids.add(entry_id)
            self._attach_stream(entry_id, events, now)
            reason = self._diagnose(entry_id, events, now)
            if reason is None:
                continue
            if now - self._last_reload.get(entry_id, -self._reload_cooldown) < self._reload_cooldown:
                continue
            self._last_reload[entry_id] = now
            _LOGGER.warning("Hue EventStream watchdog reloading %s (%s)", entry_id, reason)
            self.forget(entry_id)
            await close_hue_api(entry)
            harden_hue_eventstream()
            try:
                ok = await self._hass.config_entries.async_reload(entry_id)
                if ok:
                    reloaded.append(entry_id)
                    if self._on_reloaded is not None:
                        self._on_reloaded(entry_id)
            except Exception:
                _LOGGER.exception("Hue EventStream watchdog failed reloading %s", entry_id)

        for stale_id in list(self._stream_ids):
            if stale_id not in seen_ids:
                self.forget(stale_id)
        return reloaded
