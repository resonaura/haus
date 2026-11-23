# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Headless Home Assistant instance initializer and compatibility shims."""

from __future__ import annotations

import inspect
import logging
import sys
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType, ModuleType, SimpleNamespace
from typing import Any

import homeassistant.components as ha_components
from aiohttp import web
from homeassistant import auth, config_entries, loader
from homeassistant import core as ha_core
from homeassistant.components import (
    application_credentials,
    file_upload,
    http,
    network,
    repairs,
)

logging.getLogger("homeassistant.components.camera.img_util").setLevel(logging.CRITICAL)
from homeassistant.components import (  # noqa: E402
    camera as ha_camera,
)
from homeassistant.core_config import DATA_CUSTOMIZE

try:
    from homeassistant.components import ffmpeg as ha_ffmpeg
except ImportError:
    ha_ffmpeg = None
from homeassistant.components.homeassistant.exposed_entities import (
    DATA_EXPOSED_ENTITIES,
    ExposedEntities,
)
from homeassistant.helpers import (
    area_registry as ar,
)
from homeassistant.helpers import (
    config_entry_oauth2_flow,
    entity_component,
    frame,
)
from homeassistant.helpers import (
    device_registry as dr,
)
from homeassistant.helpers import (
    entity_registry as er,
)
from homeassistant.helpers import (
    instance_id as ha_instance_id,
)
from homeassistant.helpers import (
    issue_registry as ir,
)
from homeassistant.setup import async_setup_component
from homeassistant.helpers import (
    translation as ha_translation,
)
from homeassistant.helpers.discovery_flow import DISCOVERY_FLOW_DISPATCHER, DiscoveryKey, FlowDispatcher

if __package__:
    from .deps import HaRequirementsInstaller
    from .entities import apply_config_subentries, config_subentries, signature_parameters
    from .entity_media import patch_deprecated_device_registry
    from .transports import setup_transport_shims
else:
    from deps import HaRequirementsInstaller
    from entities import apply_config_subentries, config_subentries, signature_parameters
    from entity_media import patch_deprecated_device_registry
    from transports import setup_transport_shims

_LOGGER = logging.getLogger(__name__)

# Components whose real async_setup opens OS sockets / hardware or needs HTTP server.
# Intentionally omit "hassio" so is_hassio(hass) is False; "cloud" is shimmed with a safe no-login facade.
_SHIMMED_SYSTEM_COMPONENTS: tuple[str, ...] = (
    "api",
    "auth",
    "bluetooth",
    "bluetooth_adapters",
    "camera",
    "cloud",
    "config",
    "dhcp",
    "frontend",
    "http",
    "recorder",
    "repairs",
    "ssdp",
    "usb",
    "webhook",
    "zeroconf",
)


def _ensure_cloud_module_shim() -> None:
    """Install a lightweight cloud stub only if importing HA's real cloud module fails."""
    if "homeassistant.components.cloud" in sys.modules:
        return
    try:
        __import__("homeassistant.components.cloud")
        return
    except Exception:
        pass
    stub = ModuleType("homeassistant.components.cloud")

    class CloudNotAvailable(Exception):
        pass

    class CloudNotConnected(CloudNotAvailable):
        pass

    async def _no_cloudhook(*_args: Any, **_kwargs: Any) -> str:
        raise CloudNotAvailable("Home Assistant Cloud is not configured")

    async def _noop_async(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _setup_true(*_args: Any, **_kwargs: Any) -> bool:
        return True

    stub.DOMAIN = "cloud"  # type: ignore[attr-defined]
    stub.async_setup = _setup_true  # type: ignore[attr-defined]
    stub.CloudNotAvailable = CloudNotAvailable  # type: ignore[attr-defined]
    stub.CloudNotConnected = CloudNotConnected  # type: ignore[attr-defined]
    stub.async_active_subscription = lambda _hass: False  # type: ignore[attr-defined]
    stub.async_is_logged_in = lambda _hass: False  # type: ignore[attr-defined]
    stub.async_is_connected = lambda _hass: False  # type: ignore[attr-defined]
    stub.async_remote_ui_url = lambda _hass: (_ for _ in ()).throw(CloudNotAvailable())  # type: ignore[attr-defined]
    stub.async_create_cloudhook = _no_cloudhook  # type: ignore[attr-defined]
    stub.async_delete_cloudhook = _noop_async  # type: ignore[attr-defined]
    stub.async_listen_connection_change = lambda _hass, _cb: (lambda: None)  # type: ignore[attr-defined]
    sys.modules["homeassistant.components.cloud"] = stub


@dataclass
class _StubHttp:
    """Minimal hass.http facade collecting views/redirects without binding sockets."""

    base_url: str = "http://127.0.0.1:8123"
    views: list[Any] = field(default_factory=list)
    redirects: list[tuple[str, str]] = field(default_factory=list)
    app: web.Application = field(default_factory=web.Application)

    def register_view(self, view: Any) -> None:
        self.views.append(view)

    def register_redirect(self, url: str, redirect_to: str, **_: Any) -> None:
        self.redirects.append((url, redirect_to))

    async def async_register_static_paths(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def register_static_path(self, *_args: Any, **_kwargs: Any) -> None:
        return None


@dataclass
class HaFlowRuntimeState:
    """Container for an initialized headless HomeAssistant flow instance."""

    hass: ha_core.HomeAssistant
    installer: HaRequirementsInstaller
    stub_http: _StubHttp
    frontend_base: str
    setup_on_create: bool = False


def _apply_components_overlay(components_overlay_dir: str | None) -> None:
    if not components_overlay_dir:
        return
    overlay = Path(components_overlay_dir).resolve()
    if not overlay.is_dir():
        return
    # Allow an extracted updated wheel's homeassistant/components tree to take precedence.
    overlay_str = str(overlay)
    if overlay_str not in ha_components.__path__:
        ha_components.__path__.insert(0, overlay_str)
    parent = str(overlay.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)


def _patch_async_add(state: HaFlowRuntimeState) -> None:
    """Keep ConfigEntry creation fast & isolated unless setup_on_create is enabled."""
    orig_async_add = state.hass.config_entries.async_add
    orig_async_setup = state.hass.config_entries.async_setup

    async def _haus_async_add(entry: config_entries.ConfigEntry) -> None:
        if state.setup_on_create:
            await orig_async_add(entry)
            return
        if entry.entry_id in state.hass.config_entries._entries.data:  # noqa: SLF001
            raise ha_core.HomeAssistantError(f"An entry with the id {entry.entry_id} already exists.")
        state.hass.config_entries._entries[entry.entry_id] = entry  # noqa: SLF001
        state.hass.config_entries.async_update_issues()
        state.hass.config_entries._async_dispatch(  # noqa: SLF001
            config_entries.ConfigEntryChange.ADDED, entry
        )
        state.hass.config_entries._async_schedule_save()  # noqa: SLF001

    state.hass.config_entries.async_add = _haus_async_add  # type: ignore[method-assign]
    state.hass.data["_haus_orig_async_setup"] = orig_async_setup


@contextmanager
def request_context(state: HaFlowRuntimeState):
    """Bind synthetic HTTP current_request so HA OAuth2 redirect_uri resolves cleanly."""
    fake_request = SimpleNamespace(
        headers={
            config_entry_oauth2_flow.HEADER_FRONTEND_BASE: state.frontend_base,
            "Host": state.frontend_base.replace("https://", "").replace("http://", ""),
        },
        app={http.KEY_HASS: state.hass},
    )
    token = http.current_request.set(fake_request)  # type: ignore[arg-type]
    try:
        yield
    finally:
        http.current_request.reset(token)


async def create_headless_hass(
    *,
    config_dir: str | Path,
    deps_dir: str | Path,
    frontend_base: str = "http://127.0.0.1:8123",
    components_overlay_dir: str | None = None,
    auto_install_reqs: bool | None = None,
    setup_on_create: bool = False,
) -> HaFlowRuntimeState:
    """Create and initialize a headless HomeAssistant instance for config/options flows."""
    _apply_components_overlay(components_overlay_dir)

    cfg_path = Path(config_dir).resolve()
    cfg_path.mkdir(parents=True, exist_ok=True)

    hass = ha_core.HomeAssistant(str(cfg_path))
    hass.config.skip_pip = False
    hass.config.external_url = frontend_base
    hass.config.internal_url = frontend_base
    if callable(setup_frame := getattr(frame, "async_setup", None)):
        setup_frame(hass)
    hass.data["preload_platforms"] = ["config_flow"]

    installer = HaRequirementsInstaller(deps_dir, auto_install=auto_install_reqs)
    installer.patch_homeassistant(hass)

    loader_res = loader.async_setup(hass)
    if loader_res is not None:
        await loader_res
    tr_res = ha_translation.async_setup(hass)
    if tr_res is not None:
        await tr_res

    stub_http = _StubHttp(base_url=frontend_base)
    hass.http = stub_http  # type: ignore[assignment]
    # ConfigEntries must exist and initialize before entity_registry loads (HA 2026+),
    # and device_registry must be set up and loaded before auth_manager_from_config.
    hass.config_entries = config_entries.ConfigEntries(hass, {})
    await hass.config_entries.async_initialize()

    for reg_mod in (ir, ar, dr, er):
        setup_fn = getattr(reg_mod, "async_setup", None)
        if callable(setup_fn) and reg_mod.DATA_REGISTRY not in hass.data:
            setup_res = setup_fn(hass)
            if inspect.isawaitable(setup_res):
                await setup_res
        if reg_mod.DATA_REGISTRY not in hass.data or reg_mod is dr:
            await reg_mod.async_load(hass)
    patch_deprecated_device_registry(hass)

    hass.auth = await auth.auth_manager_from_config(hass, [{"type": "homeassistant"}], [])

    # Assist dependencies resolve the real default conversation agent during setup.
    exposed_entities = ExposedEntities(hass)
    hass.data[DATA_EXPOSED_ENTITIES] = exposed_entities
    await exposed_entities.async_initialize()

    # Enable discovery flow dispatcher immediately so discovery flows do not queue forever.
    dispatcher = FlowDispatcher(hass)
    dispatcher.started = True
    hass.data[DISCOVERY_FLOW_DISPATCHER] = dispatcher

    # Initialize lightweight built-in helpers safely needed by integration config flows.
    _ensure_cloud_module_shim()
    hass.config.components.update(_SHIMMED_SYSTEM_COMPONENTS)
    await setup_transport_shims(hass)
    await ha_instance_id.async_get(hass)
    hass.data.setdefault(DATA_CUSTOMIZE, {})
    hass.data.setdefault("ffmpeg", SimpleNamespace(ffmpeg_bin="ffmpeg"))
    hass.data.setdefault("repairs", {})
    hass.data.setdefault("webhook", {})
    hass.data.setdefault(
        ha_camera.DATA_COMPONENT,
        entity_component.EntityComponent(
            _LOGGER, ha_camera.DOMAIN, hass, ha_camera.SCAN_INTERVAL
        ),
    )
    if hasattr(ha_camera, "DATA_CAMERA_PREFS") and hasattr(ha_camera, "CameraPreferences"):
        camera_prefs = ha_camera.CameraPreferences(hass)
        await camera_prefs.async_load()
        hass.data.setdefault(ha_camera.DATA_CAMERA_PREFS, camera_prefs)
    hass.data.setdefault(file_upload.DOMAIN, await file_upload.FileUploadData.create(hass))

    for builtin_comp in ("websocket_api", "persistent_notification"):
        try:
            await async_setup_component(hass, builtin_comp, {})
        except Exception as err:
            _LOGGER.debug("%s setup warning: %s", builtin_comp, err)

    try:
        await network.async_setup(hass, {})
        hass.config.components.add("network")
    except Exception as err:  # pragma: no cover - defensive across restricted network sandboxes
        _LOGGER.debug("network.async_setup fallback active: %s", err)
        hass.config.components.add("network")

    try:
        await application_credentials.async_setup(hass, {})
        hass.config.components.add("application_credentials")
    except Exception as err:
        _LOGGER.debug("application_credentials setup warning: %s", err)

    hass.config.components.add("ffmpeg")
    hass.config.components.add("file_upload")
    # Pre-populate HA's loaded-integration cache for every shimmed system component so
    # loader.async_get_loaded_integration(hass, domain) succeeds (e.g. camera, bluetooth_adapters, webhook).
    await loader.async_get_integrations(
        hass,
        (
            *_SHIMMED_SYSTEM_COMPONENTS,
            "ffmpeg",
            "file_upload",
            "network",
            "application_credentials",
        ),
    )
    hass.set_state(ha_core.CoreState.running)
    ffmpeg_mod = ha_ffmpeg  # ensure imported namespace stays live when haffmpeg is installed
    repairs_mod = repairs
    _ = (ffmpeg_mod, repairs_mod)

    state = HaFlowRuntimeState(
        hass=hass,
        installer=installer,
        stub_http=stub_http,
        frontend_base=frontend_base.rstrip("/"),
        setup_on_create=setup_on_create,
    )
    _patch_async_add(state)
    return state


async def sync_haus_state(state: HaFlowRuntimeState, payload: dict[str, Any]) -> dict[str, Any]:
    """Synchronize persisted Haus entries, registries, and OAuth credentials into HA."""
    hass = state.hass
    if base := payload.get("frontendBase"):
        state.frontend_base = str(base).rstrip("/")
        hass.config.external_url = state.frontend_base
        hass.config.internal_url = state.frontend_base

    if "setupOnCreate" in payload:
        state.setup_on_create = bool(payload["setupOnCreate"])

    # Sync existing config entries so unique_id checks, single_instance, options & reauth work.
    if isinstance(payload.get("entries"), list):
        items = config_entries.ConfigEntryItems(hass)
        for raw in payload["entries"]:
            entry_id = str(raw.get("entryId") or raw.get("entry_id") or uuid.uuid4().hex)
            domain = str(raw.get("domain") or "").strip()
            if not domain:
                continue
            disabled_by_raw = raw.get("disabledBy") or raw.get("disabled_by")
            disabled_by = (
                config_entries.ConfigEntryDisabler(disabled_by_raw)
                if disabled_by_raw in {e.value for e in config_entries.ConfigEntryDisabler}
                else None
            )
            existing = hass.config_entries.async_get_entry(entry_id)
            if existing is not None and existing.domain == domain:
                if existing.state == config_entries.ConfigEntryState.FAILED_UNLOAD:
                    existing._async_set_state(hass, config_entries.ConfigEntryState.NOT_LOADED, None)  # noqa: SLF001
                was_disabled_by = existing.disabled_by
                unique_id = existing.unique_id
                if "uniqueId" in raw:
                    unique_id = str(raw["uniqueId"]) if raw["uniqueId"] is not None else None
                elif "unique_id" in raw:
                    unique_id = str(raw["unique_id"]) if raw["unique_id"] is not None else None
                hass.config_entries.async_update_entry(
                    existing,
                    data=dict(raw.get("data") or {}),
                    options=dict(raw.get("options") or {}),
                    title=str(raw.get("title") or domain),
                    unique_id=unique_id,
                    version=int(raw.get("version", existing.version)),
                    minor_version=int(raw.get("minorVersion", raw.get("minor_version", existing.minor_version))),
                )
                if was_disabled_by != disabled_by:
                    await hass.config_entries.async_set_disabled_by(entry_id, disabled_by)
                    existing = hass.config_entries.async_get_entry(entry_id) or existing
                if "subentries" in raw:
                    apply_config_subentries(hass, existing, raw["subentries"])
                items[entry_id] = existing
                continue
            dkeys: dict[str, tuple[DiscoveryKey, ...]] = {}
            raw_dkeys = raw.get("discoveryKeys") or raw.get("discovery_keys") or {}
            if isinstance(raw_dkeys, dict):
                for disc_domain, keys in raw_dkeys.items():
                    if isinstance(keys, list):
                        dkeys[str(disc_domain)] = tuple(
                            DiscoveryKey(
                                domain=str(k.get("domain", disc_domain)),
                                key=tuple(k["key"]) if isinstance(k.get("key"), list) else str(k.get("key", "")),
                                version=int(k.get("version", 1)),
                            )
                            for k in keys
                            if isinstance(k, dict)
                        )
            source = str(raw.get("source") or config_entries.SOURCE_USER)
            if source == "migration":
                source = config_entries.SOURCE_IMPORT
            desired_subentries = config_subentries(raw.get("subentries")) if "subentries" in raw else {}
            subentries_data = [
                {
                    "subentry_id": item.subentry_id,
                    "subentry_type": item.subentry_type,
                    "title": item.title,
                    "data": dict(item.data),
                    "unique_id": item.unique_id,
                }
                for item in desired_subentries.values()
            ]
            constructor_parameters = signature_parameters(config_entries.ConfigEntry)
            if subentries_data and "subentries_data" not in constructor_parameters:
                raise RuntimeError("ha_config_subentries_unsupported")
            entry = config_entries.ConfigEntry(
                **({"subentries_data": subentries_data} if "subentries_data" in constructor_parameters else {}),
                data=dict(raw.get("data") or {}),
                discovery_keys=MappingProxyType(dkeys),
                domain=domain,
                entry_id=entry_id,
                minor_version=int(raw.get("minorVersion", raw.get("minor_version", 1))),
                options=dict(raw.get("options") or {}),
                source=source,
                title=str(raw.get("title") or domain),
                unique_id=(
                    str(raw["uniqueId"])
                    if raw.get("uniqueId") is not None
                    else (str(raw["unique_id"]) if raw.get("unique_id") is not None else None)
                ),
                version=int(raw.get("version", 1)),
                disabled_by=disabled_by,
            )
            items[entry_id] = entry
        hass.config_entries._entries = items  # noqa: SLF001

    if isinstance(payload.get("areas"), list):
        area_reg = ar.async_get(hass)
        for area in payload["areas"]:
            name = str(area.get("name") or "").strip()
            if not name:
                continue
            existing = area_reg.async_get_area_by_name(name)
            if existing is None:
                area_reg.async_create(name)

    if isinstance(payload.get("applicationCredentials"), list):
        for cred in payload["applicationCredentials"]:
            domain = str(cred.get("domain") or "").strip()
            client_id = str(cred.get("clientId") or cred.get("client_id") or "").strip()
            client_secret = str(cred.get("clientSecret") or cred.get("client_secret") or "").strip()
            if domain and client_id:
                try:
                    await state.installer.ensure_domain(hass, domain)
                    await application_credentials.async_import_client_credential(
                        hass,
                        domain,
                        application_credentials.ClientCredential(
                            client_id=client_id,
                            client_secret=client_secret,
                            name=cred.get("name"),
                        ),
                        auth_domain=cred.get("authDomain") or cred.get("auth_domain"),
                    )
                except Exception as err:
                    _LOGGER.debug("Failed importing credential for %s: %s", domain, err)

    return {"ok": True, "entriesCount": len(hass.config_entries.async_entries())}
