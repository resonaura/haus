# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Convert Haus discovery payloads into native Home Assistant ServiceInfo and trigger flows."""

from __future__ import annotations

import base64
from importlib import import_module
import ipaddress
import logging
import time
from typing import Any

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.discovery_flow import DiscoveryKey

if __package__:
    from .shims import HaFlowRuntimeState, request_context
else:
    from shims import HaFlowRuntimeState, request_context

_LOGGER = logging.getLogger(__name__)

PROTOCOL_SOURCE_MAP: dict[str, str] = {
    "zeroconf": config_entries.SOURCE_ZEROCONF,
    "homekit": config_entries.SOURCE_HOMEKIT,
    "ssdp": config_entries.SOURCE_SSDP,
    "dhcp": config_entries.SOURCE_DHCP,
    "bluetooth": config_entries.SOURCE_BLUETOOTH,
    "usb": config_entries.SOURCE_USB,
    "mqtt": config_entries.SOURCE_MQTT,
    "hassio": config_entries.SOURCE_HASSIO,
}


def _import_attr(candidates: tuple[str, ...], attr: str) -> Any:
    for mod_name in candidates:
        try:
            mod = import_module(mod_name)
            if hasattr(mod, attr):
                return getattr(mod, attr)
        except Exception:
            continue
    raise ImportError(f"Unable to locate {attr} in {candidates}")


def _decode_bytes(raw: Any) -> bytes:
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if isinstance(raw, list):
        return bytes(int(x) & 0xFF for x in raw)
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("hex:"):
            return bytes.fromhex(text[4:])
        try:
            return base64.b64decode(text, validate=True)
        except Exception:
            return text.encode("utf-8")
    return b""


def _normalize_properties(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if v is None:
            continue
        out[str(k)] = v
    return out


def build_service_info(protocol: str, info: dict[str, Any]) -> Any:
    """Construct the exact HA ServiceInfo dataclass expected by integration flows."""
    proto = protocol.lower().strip()

    if proto in {"zeroconf", "homekit"}:
        cls = _import_attr(
            ("homeassistant.helpers.service_info.zeroconf", "homeassistant.components.zeroconf"),
            "ZeroconfServiceInfo",
        )
        raw_ips = info.get("ipAddresses") or info.get("ip_addresses") or []
        ip_list: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        primary_raw = info.get("ipAddress") or info.get("ip_address") or info.get("host")
        if primary_raw:
            try:
                ip_list.append(ipaddress.ip_address(str(primary_raw)))
            except ValueError:
                pass
        for item in raw_ips:
            try:
                parsed = ipaddress.ip_address(str(item))
                if parsed not in ip_list:
                    ip_list.append(parsed)
            except ValueError:
                continue
        if not ip_list:
            ip_list.append(ipaddress.ip_address("127.0.0.1"))
        props = _normalize_properties(info.get("properties") or info.get("txt"))
        port_raw = info.get("port")
        port = int(port_raw) if isinstance(port_raw, (int, float)) else None
        svc_type = str(info.get("type") or ("_hap._tcp.local." if proto == "homekit" else "_http._tcp.local."))
        if not svc_type.endswith("."):
            svc_type = f"{svc_type}."
        name = str(info.get("name") or info.get("hostname") or "device")
        if not name.endswith(svc_type):
            name = f"{name}.{svc_type}"
        hostname = str(info.get("hostname") or info.get("host") or name)
        return cls(
            ip_address=ip_list[0],
            ip_addresses=ip_list,
            port=port,
            hostname=hostname,
            type=svc_type,
            name=name,
            properties=props,
        )

    if proto == "ssdp":
        cls = _import_attr(
            ("homeassistant.helpers.service_info.ssdp", "homeassistant.components.ssdp"),
            "SsdpServiceInfo",
        )
        upnp = dict(info.get("upnp") or {})
        headers = dict(info.get("ssdpHeaders") or info.get("ssdp_headers") or {})
        location = info.get("ssdpLocation") or info.get("ssdp_location") or info.get("location")
        st = str(info.get("ssdpSt") or info.get("ssdp_st") or info.get("st") or "upnp:rootdevice")
        usn = str(info.get("ssdpUsn") or info.get("ssdp_usn") or info.get("usn") or f"uuid:{info.get('udn', 'unknown')}::{st}")
        all_locs = set(info.get("ssdpAllLocations") or info.get("ssdp_all_locations") or ([] if not location else [location]))
        matching_domains = set(info.get("matchingDomains") or [])
        return cls(
            ssdp_usn=usn,
            ssdp_st=st,
            upnp=upnp,
            ssdp_location=location,
            ssdp_nt=info.get("ssdpNt") or info.get("ssdp_nt") or info.get("nt"),
            ssdp_udn=info.get("ssdpUdn") or info.get("ssdp_udn") or upnp.get("UDN"),
            ssdp_ext=info.get("ssdpExt") or info.get("ssdp_ext"),
            ssdp_server=info.get("ssdpServer") or info.get("ssdp_server") or info.get("server"),
            ssdp_headers=headers,
            ssdp_all_locations=all_locs,
            x_homeassistant_matching_domains=matching_domains,
        )

    if proto == "dhcp":
        cls = _import_attr(
            ("homeassistant.helpers.service_info.dhcp", "homeassistant.components.dhcp"),
            "DhcpServiceInfo",
        )
        return cls(
            ip=str(info.get("ip") or info.get("ipAddress") or "0.0.0.0"),
            hostname=str(info.get("hostname") or ""),
            macaddress=str(info.get("macaddress") or info.get("mac") or "").lower().replace(":", "").replace("-", ""),
        )

    if proto == "bluetooth":
        from bleak.backends.device import BLEDevice
        from bleak.backends.scanner import AdvertisementData
        from homeassistant.components.bluetooth import BluetoothServiceInfoBleak

        address = str(info.get("address") or "00:00:00:00:00:00").upper()
        name = str(info.get("name") or info.get("localName") or info.get("local_name") or address)
        rssi = int(info.get("rssi", -60))
        mfg_raw = info.get("manufacturerData") or info.get("manufacturer_data") or {}
        mfg_data: dict[int, bytes] = {int(k): _decode_bytes(v) for k, v in mfg_raw.items()}
        svc_raw = info.get("serviceData") or info.get("service_data") or {}
        svc_data: dict[str, bytes] = {str(k).lower(): _decode_bytes(v) for k, v in svc_raw.items()}
        svc_uuids = [str(u).lower() for u in (info.get("serviceUuids") or info.get("service_uuids") or [])]
        source = str(info.get("source") or "local")
        tx_power = info.get("txPower") or info.get("tx_power")
        connectable = bool(info.get("connectable", True))
        dev = BLEDevice(address, name, {})
        adv = AdvertisementData(
            local_name=name or None,
            manufacturer_data=mfg_data,
            service_data=svc_data,
            service_uuids=svc_uuids,
            tx_power=int(tx_power) if tx_power is not None else None,
            rssi=rssi,
            platform_data=(),
        )
        return BluetoothServiceInfoBleak(
            name=name,
            address=address,
            rssi=rssi,
            manufacturer_data=mfg_data,
            service_data=svc_data,
            service_uuids=svc_uuids,
            source=source,
            device=dev,
            advertisement=adv,
            connectable=connectable,
            time=float(info.get("time") or time.monotonic()),
            tx_power=int(tx_power) if tx_power is not None else None,
            raw=_decode_bytes(info.get("raw")) if info.get("raw") is not None else None,
        )

    if proto == "usb":
        cls = _import_attr(
            ("homeassistant.helpers.service_info.usb", "homeassistant.components.usb"),
            "UsbServiceInfo",
        )
        return cls(
            device=str(info.get("device") or "/dev/ttyUSB0"),
            vid=str(info.get("vid") or "").upper(),
            pid=str(info.get("pid") or "").upper(),
            serial_number=info.get("serialNumber") or info.get("serial_number"),
            manufacturer=info.get("manufacturer"),
            description=info.get("description"),
        )

    if proto == "mqtt":
        cls = _import_attr(
            ("homeassistant.helpers.service_info.mqtt", "homeassistant.components.mqtt"),
            "MqttServiceInfo",
        )
        topic = str(info.get("topic") or "")
        return cls(
            topic=topic,
            payload=info.get("payload", ""),
            qos=int(info.get("qos", 0)),
            retain=bool(info.get("retain", False)),
            subscribed_topic=str(info.get("subscribedTopic") or info.get("subscribed_topic") or topic),
            timestamp=float(info.get("timestamp") or time.time()),
        )

    if proto == "hassio":
        cls = _import_attr(("homeassistant.helpers.service_info.hassio",), "HassioServiceInfo")
        return cls(
            config=dict(info.get("config") or {}),
            name=str(info.get("name") or ""),
            slug=str(info.get("slug") or ""),
            uuid=str(info.get("uuid") or info.get("slug") or ""),
        )

    raise ValueError(f"Unsupported discovery protocol: {protocol}")


async def trigger_discovery(
    state: HaFlowRuntimeState,
    *,
    domain: str,
    protocol: str,
    info: dict[str, Any],
    discovery_key: str | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """Run an HA discovery config flow step (async_step_<protocol>) and return result."""
    hass: HomeAssistant = state.hass
    proto = protocol.lower().strip()
    source = PROTOCOL_SOURCE_MAP.get(proto)
    if source is None:
        raise ValueError(f"Unsupported discovery protocol: {protocol}")

    await state.installer.ensure_domain(hass, domain)
    service_info = build_service_info(proto, info)
    if proto == "bluetooth":
        try:
            import habluetooth

            habluetooth.get_manager().scanner_adv_received(service_info)
        except Exception as err:
            _LOGGER.debug("Skipping habluetooth cache update: %s", err)
    dkey = (
        DiscoveryKey(domain=proto, key=discovery_key, version=1)
        if discovery_key
        else None
    )
    context: dict[str, Any] = {"source": source}
    if dkey is not None:
        context["discovery_key"] = dkey

    if hass.config_entries.flow.async_has_matching_discovery_flow(
        domain, context, service_info
    ):
        return "already_in_progress", None

    with request_context(state):
        raw_result = await hass.config_entries.flow.async_init(
            domain,
            context=context,  # type: ignore[arg-type]
            data=service_info,
        )
    return "result", dict(raw_result)
