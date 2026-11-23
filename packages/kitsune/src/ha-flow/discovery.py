# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Convert Haus discovery payloads into native Home Assistant ServiceInfo and trigger flows."""

from __future__ import annotations

import base64
import ipaddress
import logging
import time
from importlib import import_module
from typing import Any
from urllib.parse import urlparse

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.discovery_flow import DiscoveryKey

try:
    from async_upnp_client.utils import CaseInsensitiveDict
except ImportError:  # pragma: no cover - fallback when async_upnp_client is absent
    CaseInsensitiveDict = None  # type: ignore[assignment,misc]

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


class _FallbackCaseInsensitiveDict(dict[str, Any]):
    """Case-insensitive dict fallback for SSDP headers when async_upnp_client is absent."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        super().__init__()
        self._lower_map: dict[str, str] = {}
        for k, v in (data or {}).items():
            self[k] = v

    def __setitem__(self, key: str, value: Any) -> None:
        ks = str(key)
        low = ks.lower()
        if low in self._lower_map and self._lower_map[low] != ks:
            super().pop(self._lower_map[low], None)
        self._lower_map[low] = ks
        super().__setitem__(ks, value)

    def __getitem__(self, key: str) -> Any:
        actual = self._lower_map.get(str(key).lower(), str(key))
        return super().__getitem__(actual)

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and key.lower() in self._lower_map

    def get(self, key: str, default: Any = None) -> Any:
        actual = self._lower_map.get(str(key).lower())
        return super().get(actual, default) if actual is not None else default


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
        key = str(k)
        if key == "_raw" and isinstance(v, dict):
            out[key] = {
                str(rk): (rv if isinstance(rv, bytes) else str(rv).encode("utf-8"))
                for rk, rv in v.items()
                if rv is not None
            }
        elif isinstance(v, bool):
            out[key] = "true" if v else "false"
        elif isinstance(v, (int, float)):
            out[key] = str(v)
        elif isinstance(v, (bytes, str)):
            out[key] = v
        else:
            out[key] = str(v)
    return out


def _is_ip_literal(value: str) -> bool:
    if not value:
        return False
    cleaned = value.strip().rstrip(".")
    try:
        ipaddress.ip_address(cleaned.split("%", 1)[0])
        return True
    except ValueError:
        return False


def _strip_service_suffix(label: str, svc_type: str) -> str:
    val = label.strip()
    svc_no_dot = svc_type.rstrip(".")
    for suffix in (f".{svc_type}", f".{svc_no_dot}"):
        if val.lower().endswith(suffix.lower()):
            val = val[: -len(suffix)]
            break
    else:
        if "._" in val:
            val = val.split("._", 1)[0]
    for local_suf in (".local.", ".local", "."):
        if val.lower().endswith(local_suf):
            val = val[: -len(local_suf)]
            break
    return val.strip() or "device"


def _normalize_mdns_hostname(info: dict[str, Any], instance_label: str, svc_type: str) -> str:
    for candidate_key in ("hostname", "server", "host"):
        raw = str(info.get(candidate_key) or "").strip()
        if raw and not _is_ip_literal(raw):
            base = _strip_service_suffix(raw, svc_type)
            return f"{base}.local."
    base = _strip_service_suffix(instance_label, svc_type)
    return f"{base}.local."


def _normalize_hex_id(raw: Any) -> str:
    val = str(raw or "").strip().upper()
    if val.startswith("0X"):
        val = val[2:]
    return val.zfill(4) if val else ""


def build_service_info(protocol: str, info: dict[str, Any]) -> Any:
    """Construct the exact HA ServiceInfo dataclass expected by integration flows."""
    proto = protocol.lower().strip()

    if proto in {"zeroconf", "homekit"}:
        cls = _import_attr(
            ("homeassistant.helpers.service_info.zeroconf", "homeassistant.components.zeroconf"),
            "ZeroconfServiceInfo",
        )
        raw_ips = list(info.get("ipAddresses") or info.get("ip_addresses") or [])
        primary_raw = info.get("ipAddress") or info.get("ip_address") or info.get("host")
        if primary_raw:
            raw_ips.insert(0, primary_raw)
        parsed_ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for item in raw_ips:
            try:
                cleaned = str(item).strip().split("%", 1)[0]
                parsed = ipaddress.ip_address(cleaned)
                if parsed not in parsed_ips:
                    parsed_ips.append(parsed)
            except ValueError:
                continue
        routable_v4 = [
            ip for ip in parsed_ips if ip.version == 4 and not ip.is_link_local and not ip.is_unspecified
        ]
        routable_v6 = [
            ip for ip in parsed_ips if ip.version == 6 and not ip.is_link_local and not ip.is_unspecified
        ]
        fallback_ips = [ip for ip in parsed_ips if ip.is_link_local or ip.is_unspecified]
        ip_list = [*routable_v4, *routable_v6, *fallback_ips]
        if not ip_list:
            ip_list = [ipaddress.ip_address("127.0.0.1")]
        props = _normalize_properties(info.get("properties") or info.get("txt"))
        port_raw = info.get("port")
        port = int(port_raw) if isinstance(port_raw, (int, float)) else 80
        svc_type = str(
            info.get("type") or ("_hap._tcp.local." if proto == "homekit" else "_http._tcp.local.")
        ).strip()
        if not svc_type.endswith("."):
            svc_type = f"{svc_type}."
        if not svc_type.lower().endswith(".local."):
            svc_type = f"{svc_type.rstrip('.')}.local."
        raw_name = str(info.get("name") or info.get("hostname") or "device").strip()
        instance_label = _strip_service_suffix(raw_name, svc_type)
        name = f"{instance_label}.{svc_type}"
        hostname = _normalize_mdns_hostname(info, instance_label, svc_type)
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
        raw_headers = dict(info.get("ssdpHeaders") or info.get("ssdp_headers") or info.get("headers") or {})
        raw_host = str(info.get("host") or raw_headers.get("_host") or "").strip()
        location = (
            info.get("ssdpLocation")
            or info.get("ssdp_location")
            or info.get("location")
            or raw_headers.get("location")
            or raw_headers.get("LOCATION")
            or (f"http://{raw_host}/description.xml" if raw_host else None)
        )
        parsed_loc = urlparse(str(location)) if location else None
        host = (parsed_loc.hostname if parsed_loc and parsed_loc.hostname else None) or raw_host
        st = str(
            info.get("ssdpSt")
            or info.get("ssdp_st")
            or info.get("st")
            or info.get("ssdpNt")
            or info.get("ssdp_nt")
            or info.get("nt")
            or "upnp:rootdevice"
        )
        raw_udn = str(
            info.get("ssdpUdn")
            or info.get("ssdp_udn")
            or upnp.get("UDN")
            or upnp.get("udn")
            or info.get("udn")
            or ""
        ).strip()
        raw_usn = str(info.get("ssdpUsn") or info.get("ssdp_usn") or info.get("usn") or "").strip()
        if not raw_udn and raw_usn.startswith("uuid:"):
            raw_udn = raw_usn.split("::", 1)[0]
        if not raw_udn:
            raw_udn = f"uuid:{host or 'unknown'}"
        elif not raw_udn.startswith("uuid:"):
            raw_udn = f"uuid:{raw_udn}"
        usn = raw_usn or f"{raw_udn}::{st}"
        upnp["UDN"] = raw_udn
        upnp.setdefault(
            "friendlyName",
            str(upnp.get("friendly_name") or info.get("friendlyName") or info.get("name") or host or "Device"),
        )
        upnp.setdefault("manufacturer", str(upnp.get("manufacturer") or info.get("manufacturer") or ""))
        upnp.setdefault(
            "modelName",
            str(upnp.get("model_name") or info.get("modelName") or info.get("model") or upnp["friendlyName"]),
        )
        upnp.setdefault(
            "modelDescription",
            str(upnp.get("model_description") or info.get("modelDescription") or upnp["modelName"]),
        )
        upnp.setdefault("modelNumber", str(upnp.get("model_number") or info.get("modelNumber") or ""))
        upnp.setdefault(
            "serialNumber",
            str(upnp.get("serial_number") or info.get("serialNumber") or raw_udn.removeprefix("uuid:")),
        )
        if location and "presentationURL" not in upnp:
            origin = (
                f"{parsed_loc.scheme}://{parsed_loc.netloc}/"
                if parsed_loc and parsed_loc.scheme and parsed_loc.netloc
                else str(location)
            )
            upnp["presentationURL"] = origin
        if location:
            raw_headers.setdefault("location", str(location))
        if host:
            raw_headers.setdefault("_host", host)
        if parsed_loc and parsed_loc.port:
            raw_headers.setdefault("_port", str(parsed_loc.port))
        raw_headers.setdefault("st", st)
        raw_headers.setdefault("usn", usn)
        raw_headers.setdefault("_udn", raw_udn)
        headers = (
            CaseInsensitiveDict(raw_headers)
            if CaseInsensitiveDict is not None
            else _FallbackCaseInsensitiveDict(raw_headers)
        )
        all_locs = set(
            info.get("ssdpAllLocations")
            or info.get("ssdp_all_locations")
            or ([] if not location else [str(location)])
        )
        matching_domains = set(info.get("matchingDomains") or [])
        return cls(
            ssdp_usn=usn,
            ssdp_st=st,
            upnp=upnp,
            ssdp_location=str(location) if location else None,
            ssdp_nt=info.get("ssdpNt") or info.get("ssdp_nt") or info.get("nt") or st,
            ssdp_udn=raw_udn,
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
        raw_host = str(info.get("hostname") or "").strip()
        for local_suf in (".local.", ".local", "."):
            if raw_host.lower().endswith(local_suf):
                raw_host = raw_host[: -len(local_suf)]
                break
        mac = (
            str(info.get("macaddress") or info.get("mac") or "")
            .lower()
            .replace(":", "")
            .replace("-", "")
            .replace(".", "")
        )
        return cls(
            ip=str(info.get("ip") or info.get("ipAddress") or "0.0.0.0"),
            hostname=raw_host,
            macaddress=mac,
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
            vid=_normalize_hex_id(info.get("vid")),
            pid=_normalize_hex_id(info.get("pid")),
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
    elif proto == "ssdp":
        ssdp_data = hass.data.get("ssdp")
        scanner = ssdp_data.get("scanner") if isinstance(ssdp_data, dict) else None
        if scanner is not None and callable(getattr(scanner, "record_discovery", None)):
            scanner.record_discovery(service_info)
    dkey = (
        DiscoveryKey(domain=proto, key=discovery_key, version=1)
        if discovery_key
        else None
    )
    context: dict[str, Any] = {"source": source}
    if dkey is not None:
        context["discovery_key"] = dkey
        context["haus_candidate_id"] = discovery_key

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
