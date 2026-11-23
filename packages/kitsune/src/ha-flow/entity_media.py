# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Official HA ImageEntity / UpdateEntity accessors and custom-component compatibility shims."""

from __future__ import annotations

import base64
import functools
import logging
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

_LOGGER = logging.getLogger(__name__)


def _minimal_white_png(size: int = 32) -> bytes:
    """Build a valid opaque white PNG without external imaging dependencies."""

    def _chunk(tag: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
        return struct.pack("!I", len(payload)) + tag + payload + struct.pack("!I", crc)

    raw_rows = b"".join(b"\x00" + (b"\xff\xff\xff" * size) for _ in range(size))
    ihdr = struct.pack("!IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw_rows, level=6))
        + _chunk(b"IEND", b"")
    )


def patch_deprecated_device_registry(hass: HomeAssistant) -> None:
    """Translate deprecated `via_device` tuples to `via_device_id` on HA 2026+ registries.

    Prevents HA 2026's frame.report_usage from raising RuntimeError inside concurrent
    entity_platform._async_add_entities tasks for custom integrations (e.g. eero).
    """
    registry = dr.async_get(hass)
    undefined = getattr(dr, "UNDEFINED", None)

    def _resolve_via_device_id(via: Any) -> str | None:
        if via is None or via is undefined:
            return None
        try:
            via_tuple = tuple(via)
            if len(via_tuple) == 2:
                devices_store = getattr(registry, "_devices", None)
                get_entry = getattr(devices_store, "get_entry", None)
                parent = (
                    get_entry(identifiers={via_tuple})
                    if callable(get_entry)
                    else registry.async_get_device(identifiers={via_tuple})
                )
                if parent is not None:
                    return parent.id
        except Exception:
            pass
        return None

    orig = getattr(registry, "async_get_or_create", None)
    if callable(orig) and not getattr(orig, "_haus_via_device_patched", False):

        @functools.wraps(orig)
        def _compat_async_get_or_create(*args: Any, **kwargs: Any) -> Any:
            if "via_device" in kwargs:
                via = kwargs.pop("via_device")
                if via is not None and "via_device_id" not in kwargs:
                    resolved = _resolve_via_device_id(via)
                    if resolved is not None:
                        kwargs["via_device_id"] = resolved
            return orig(*args, **kwargs)

        _compat_async_get_or_create._haus_via_device_patched = True  # type: ignore[attr-defined]
        registry.async_get_or_create = _compat_async_get_or_create  # type: ignore[method-assign]

    orig_from_info = getattr(registry, "_async_get_or_create_from_info", None)
    if callable(orig_from_info) and not getattr(
        orig_from_info, "_haus_via_device_patched", False
    ):

        @functools.wraps(orig_from_info)
        def _compat_from_info(*args: Any, **kwargs: Any) -> Any:
            device_info = kwargs.get("device_info")
            if device_info is not None:
                via = getattr(device_info, "via_device", undefined)
                if via is not undefined:
                    try:
                        setattr(device_info, "via_device", undefined)
                        if (
                            via is not None
                            and getattr(device_info, "via_device_id", undefined) is undefined
                        ):
                            resolved = _resolve_via_device_id(via)
                            if resolved is not None:
                                setattr(device_info, "via_device_id", resolved)
                    except Exception:
                        pass
            return orig_from_info(*args, **kwargs)

        _compat_from_info._haus_via_device_patched = True  # type: ignore[attr-defined]
        registry._async_get_or_create_from_info = _compat_from_info  # type: ignore[method-assign]


def _rebind_eero_logo_modules(resolved: str) -> None:
    for mod_name in ("custom_components.eero.api.const", "custom_components.eero.api"):
        mod = sys.modules.get(mod_name)
        if mod is not None and hasattr(mod, "EERO_LOGO_ICON"):
            current = getattr(mod, "EERO_LOGO_ICON", None)
            if isinstance(current, str) and not Path(current).is_file():
                setattr(mod, "EERO_LOGO_ICON", resolved)


def ensure_eero_qr_assets(hass: HomeAssistant) -> None:
    """Ensure schmittx/home-assistant-eero's hardcoded logo asset resolves under config_dir."""
    config_dir = Path(hass.config.config_dir)
    eero_dir = config_dir / "custom_components" / "eero"
    if not eero_dir.is_dir():
        return
    logo_path = eero_dir / "api" / "images" / "logo_icon_white_background.png"
    if not logo_path.is_file():
        try:
            logo_path.parent.mkdir(parents=True, exist_ok=True)
            logo_path.write_bytes(_minimal_white_png(32))
        except OSError as err:
            _LOGGER.debug("Could not materialize fallback eero QR logo: %s", err)
            return

    resolved = str(logo_path)
    _rebind_eero_logo_modules(resolved)
    if "custom_components.eero.api" not in sys.modules:
        try:
            import importlib

            importlib.import_module("custom_components.eero.api.const")
            importlib.import_module("custom_components.eero.api")
            _rebind_eero_logo_modules(resolved)
        except Exception:
            pass


async def get_entity_image(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """Fetch live PNG/JPEG/SVG bytes from an HA `image.*` entity via `async_image()`."""
    from homeassistant.components import image as ha_image

    component = hass.data.get(ha_image.DATA_COMPONENT)
    entity = component.get_entity(entity_id) if component is not None else None
    if entity is None:
        raise ValueError("image_entity_not_found")
    raw = await entity.async_image()
    if not isinstance(raw, (bytes, bytearray)) or len(raw) == 0:
        raise ValueError("image_unavailable")
    content_type = getattr(entity, "content_type", None) or "image/png"
    last_updated = getattr(entity, "image_last_updated", None)
    return {
        "entityId": entity_id,
        "contentType": str(content_type),
        "contentBase64": base64.b64encode(bytes(raw)).decode("ascii"),
        "lastUpdated": last_updated.isoformat() if hasattr(last_updated, "isoformat") else None,
    }


async def get_update_release_notes(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """Fetch official HA `update/release_notes` markdown and version metadata for an `update.*` entity."""
    from homeassistant.components import update as ha_update

    component = hass.data.get(ha_update.DATA_COMPONENT)
    entity = component.get_entity(entity_id) if component is not None else None
    if entity is None:
        raise ValueError("update_entity_not_found")

    features = getattr(entity, "supported_features_compat", None)
    if features is None:
        features = getattr(entity, "supported_features", 0) or 0
    supports_notes = bool(int(features) & int(ha_update.UpdateEntityFeature.RELEASE_NOTES))
    release_notes: str | None = None
    if supports_notes and hasattr(entity, "async_release_notes"):
        release_notes = await entity.async_release_notes()
    summary = getattr(entity, "release_summary", None)
    return {
        "entityId": entity_id,
        "releaseNotes": release_notes if release_notes is not None else summary,
        "releaseSummary": summary,
        "releaseUrl": getattr(entity, "release_url", None),
        "installedVersion": getattr(entity, "installed_version", None),
        "latestVersion": getattr(entity, "latest_version", None),
        "skippedVersion": getattr(entity, "skipped_version", None),
    }
