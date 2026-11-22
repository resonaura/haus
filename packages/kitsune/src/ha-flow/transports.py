# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Headless transport shims (Zeroconf, Bluetooth, SSDP, USB) for HA config flows."""

from __future__ import annotations

import inspect
import logging
import os
from typing import Any, Callable

from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant

try:
    from zeroconf.asyncio import AsyncServiceBrowser
except ImportError:  # pragma: no cover - optional when zeroconf is not installed
    AsyncServiceBrowser = None  # type: ignore[assignment,misc]

_LOGGER = logging.getLogger(__name__)


class _StubSsdpScanner:
    """In-memory SSDP scanner facade when OS SSDP sockets are handled by Haus Hub."""

    async def async_register_callback(
        self, *_args: Any, **_kwargs: Any
    ) -> Callable[[], None]:
        return lambda: None

    async def async_get_discovery_info_by_udn_st(
        self, *_args: Any, **_kwargs: Any
    ) -> None:
        return None

    async def async_get_discovery_info_by_st(
        self, *_args: Any, **_kwargs: Any
    ) -> list[Any]:
        return []

    async def async_get_discovery_info_by_udn(
        self, *_args: Any, **_kwargs: Any
    ) -> list[Any]:
        return []


class _StubUsbDiscovery:
    """USB facade matching Home Assistant's USBDiscovery helper surface."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.seen: set[Any] = set()
        self._serial_port_scanners: set[Callable[[HomeAssistant], list[Any]]] = set()
        self._hass = hass

    def async_register_serial_port_scanner(
        self, scanner: Callable[[HomeAssistant], list[Any]]
    ) -> Callable[[], None]:
        self._serial_port_scanners.add(scanner)
        return lambda: self._serial_port_scanners.discard(scanner)

    async def async_scan_serial_ports(self) -> list[Any]:
        ports = {}
        for scanner in tuple(self._serial_port_scanners):
            for port in scanner(self._hass):
                ports[port.device] = port
        return list(ports.values())

    def async_register_scan_request_callback(
        self, _callback: Any
    ) -> Callable[[], None]:
        return lambda: None

    async def async_is_plugged_in(self, *_args: Any, **_kwargs: Any) -> bool:
        return False


_FALLBACK_ZEROCONF_TYPES: tuple[str, ...] = (
    "_hap._tcp.local.",
    "_hap._udp.local.",
    "_airplay._tcp.local.",
    "_airport._tcp.local.",
    "_appletv-v2._tcp.local.",
    "_companion-link._tcp.local.",
    "_hscp._tcp.local.",
    "_mediaremotetv._tcp.local.",
    "_raop._tcp.local.",
    "_sleep-proxy._udp.local.",
    "_touch-able._tcp.local.",
)


def _collect_zeroconf_service_types(zc_mod: Any) -> list[str]:
    """Collect Home Assistant's registered mDNS service types so zeroconf cache stays warm."""
    types: set[str] = set(_FALLBACK_ZEROCONF_TYPES)
    for item in getattr(zc_mod, "HOMEKIT_TYPES", ()):
        if isinstance(item, str) and item:
            types.add(item)
    try:
        from homeassistant.generated import zeroconf as generated_zc

        for svc_type in getattr(generated_zc, "ZEROCONF", ()):
            if isinstance(svc_type, str) and svc_type:
                types.add(svc_type)
    except Exception as err:  # pragma: no cover - defensive fallback
        _LOGGER.debug("Generated zeroconf service list unavailable: %s", err)
    return sorted(types)


def _attach_zeroconf_browser(
    hass: HomeAssistant, zc_mod: Any, aio_zc: Any
) -> None:
    """Keep zeroconf's AsyncServiceBrowser warm for HAP, AirPlay/Companion/RAOP, and HA mDNS types."""
    if AsyncServiceBrowser is None:
        return
    zc = getattr(aio_zc, "zeroconf", None)
    if zc is None:
        return

    service_types = _collect_zeroconf_service_types(zc_mod)
    listeners = getattr(zc, "listeners", ())
    for listener in listeners:
        types = getattr(listener, "types", ())
        if isinstance(listener, AsyncServiceBrowser) and all(
            svc_type in types for svc_type in _FALLBACK_ZEROCONF_TYPES
        ):
            return

    def _noop_handler(**_kwargs: Any) -> None:
        return None

    browser = AsyncServiceBrowser(
        zc, service_types, handlers=[_noop_handler]
    )

    async def _stop_browser(_event: Event) -> None:
        try:
            await browser.async_cancel()
        except Exception as err:  # pragma: no cover - defensive shutdown
            _LOGGER.debug("Ignoring zeroconf browser shutdown error: %s", err)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _stop_browser)


def _install_zeroconf_hook() -> None:
    """Ensure lazy zeroconf._async_get_instance binds HA mDNS service browsers safely."""
    try:
        from homeassistant.components import zeroconf as zc_mod
    except ImportError as err:  # pragma: no cover - optional when zeroconf is not installed
        _LOGGER.debug("Zeroconf helper package unavailable in environment: %s", err)
        return

    orig_fn = getattr(zc_mod, "_async_get_instance", None)
    if orig_fn is None or getattr(orig_fn, "_haus_wrapped", False):
        return

    instance_key = getattr(zc_mod, "DATA_INSTANCE", zc_mod.DOMAIN)

    def attach(hass: HomeAssistant, aio_zc: Any, already_cached: bool) -> Any:
        if not already_cached:
            _attach_zeroconf_browser(hass, zc_mod, aio_zc)
        return aio_zc

    async def get_instance_async(
        hass: HomeAssistant, **zcargs: Any
    ) -> Any:
        already_cached = instance_key in hass.data
        try:
            aio_zc = await orig_fn(hass, **zcargs)
        except OSError as err:
            _LOGGER.debug("Zeroconf default socket init failed, retrying localhost: %s", err)
            aio_zc = await orig_fn(hass, interfaces=["127.0.0.1"])
        return attach(hass, aio_zc, already_cached)

    def get_instance_sync(hass: HomeAssistant) -> Any:
        already_cached = instance_key in hass.data
        return attach(hass, orig_fn(hass), already_cached)

    get_instance = get_instance_async if inspect.iscoroutinefunction(orig_fn) else get_instance_sync
    setattr(get_instance, "_haus_wrapped", True)
    zc_mod._async_get_instance = get_instance  # noqa: SLF001


async def _warmup_zeroconf(hass: HomeAssistant) -> None:
    """Start zeroconf service browser eagerly in runtime so mDNS cache is warm before setup_entry."""
    if os.environ.get("VITEST") or os.environ.get("NODE_ENV") == "test" or os.environ.get("PYTEST_CURRENT_TEST"):
        return
    try:
        from homeassistant.components import zeroconf as zc_mod

        await zc_mod.async_get_async_instance(hass)
    except Exception as err:  # pragma: no cover - restricted network sandbox
        _LOGGER.debug("Zeroconf eager warmup skipped: %s", err)


async def _setup_bluetooth_manager(hass: HomeAssistant) -> None:
    """Initialize headless habluetooth/HA BluetoothManager without hardware probing."""
    try:
        from bleak_retry_connector import BleakSlotManager
        from bluetooth_adapters import BluetoothAdapters
        import habluetooth
        from homeassistant.components.bluetooth import passive_update_processor
        from homeassistant.components.bluetooth.manager import (
            HomeAssistantBluetoothManager,
        )
        from homeassistant.components.bluetooth.match import IntegrationMatcher
        from homeassistant.components.bluetooth.storage import BluetoothStorage
    except Exception as err:
        _LOGGER.debug("Bluetooth helper packages unavailable in environment: %s", err)
        return

    if passive_update_processor.PASSIVE_UPDATE_PROCESSOR not in hass.data:
        await passive_update_processor.async_setup(hass)

    try:
        existing = habluetooth.get_manager()
    except RuntimeError:
        existing = None
    if existing is not None and getattr(existing, "hass", None) is hass:
        return

    class _NoopBluetoothAdapters(BluetoothAdapters):
        @property
        def adapters(self) -> dict[str, Any]:
            return {}

        @property
        def default_adapter(self) -> str:
            return ""

        async def refresh(self) -> None:
            return None

        @property
        def history(self) -> dict[str, Any]:
            return {}

        @property
        def bleak_callbacks(self) -> list[Any]:
            return []

    storage = BluetoothStorage(hass)
    await storage.async_setup()
    slot_manager = BleakSlotManager()
    await slot_manager.async_setup()
    integration_matcher = IntegrationMatcher([])
    integration_matcher.async_setup()
    manager = HomeAssistantBluetoothManager(
        hass,
        integration_matcher,
        _NoopBluetoothAdapters(),
        storage,
        slot_manager,
    )
    habluetooth.set_manager(manager)
    await manager.async_setup()

    def _stop_bt(_event: Event) -> None:
        manager.async_stop()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _stop_bt)


async def setup_transport_shims(hass: HomeAssistant) -> None:
    """Populate HA discovery helper facades needed by integration config flows."""
    hass.data.setdefault("usb", _StubUsbDiscovery(hass))
    hass.data.setdefault("ssdp", {"scanner": _StubSsdpScanner()})
    _install_zeroconf_hook()
    await _warmup_zeroconf(hass)
    await _setup_bluetooth_manager(hass)
