# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Headless Home Assistant config/options/discovery flow NDJSON worker."""

from __future__ import annotations

import asyncio
import base64
from importlib.metadata import version as pkg_version
import json
import logging
import os
from pathlib import Path
import sys
import traceback
from typing import Any

from homeassistant import config_entries, data_entry_flow, loader
from homeassistant.components import application_credentials, file_upload
from homeassistant.generated import config_flows as generated_flows
from homeassistant.helpers import config_entry_oauth2_flow, translation as ha_translation
from homeassistant.helpers.json import ExtendedJSONEncoder, json_dumps
from homeassistant.util import raise_if_invalid_filename
from homeassistant.util.ulid import ulid_hex

_PKG_DIR = str(Path(__file__).resolve().parent)
if not __package__ and _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)

if __package__:
    from .deps import MissingRequirementsError
    from .discovery import trigger_discovery
    from .serializer import serialize_flow_result, serialize_progress_flows
    from .shims import HaFlowRuntimeState, create_headless_hass, request_context, sync_haus_state
else:
    from deps import MissingRequirementsError
    from discovery import trigger_discovery
    from serializer import serialize_flow_result, serialize_progress_flows
    from shims import HaFlowRuntimeState, create_headless_hass, request_context, sync_haus_state


class HaFlowWorker:
    """Handle JSON-RPC requests against a single headless HomeAssistant instance."""

    def __init__(self, state: HaFlowRuntimeState) -> None:
        self.state = state
        self._flow_kinds: dict[str, str] = {}
        self._flow_meta: dict[str, dict[str, Any]] = {}

    def _manager_for(self, flow_id: str | None = None, flow_kind: str | None = None) -> Any:
        kind = flow_kind or (self._flow_kinds.get(flow_id or "") if flow_id else None) or "config"
        return (
            self.state.hass.config_entries.options
            if kind == "options"
            else self.state.hass.config_entries.flow
        )

    async def _resolve_virtual_handler(self, domain: str) -> tuple[str, str | None, str | None]:
        try:
            integ = await loader.async_get_integration(self.state.hass, domain)
            supported_by = integ.manifest.get("supported_by")
            if isinstance(supported_by, str) and supported_by:
                return supported_by, domain, integ.name
            return domain, None, integ.name
        except loader.IntegrationNotFound:
            return domain, None, None

    async def handle_command(self, cmd: str, params: dict[str, Any]) -> Any:
        hass = self.state.hass
        if cmd == "health":
            return {
                "ok": True,
                "pythonVersion": sys.version.split()[0],
                "haVersion": pkg_version("homeassistant"),
                "depsDir": str(self.state.installer.deps_dir),
                "autoInstallReqs": self.state.installer.auto_install,
                "entriesCount": len(hass.config_entries.async_entries()),
            }

        if cmd == "sync_state":
            return await sync_haus_state(self.state, params)

        if cmd == "flow_init":
            return await self._cmd_flow_init(params)

        if cmd == "flow_configure":
            return await self._cmd_flow_configure(params)

        if cmd == "flow_get":
            flow_id = str(params["flowId"])
            flow_kind = str(params.get("flowKind") or self._flow_kinds.get(flow_id, "config"))
            mgr = self._manager_for(flow_id, flow_kind)
            with request_context(self.state):
                raw = await mgr.async_configure(flow_id)
            meta = self._flow_meta.get(flow_id, {})
            return await serialize_flow_result(
                hass,
                dict(raw),
                mgr=mgr,
                flow_kind=flow_kind,
                virtual_domain=meta.get("virtual_domain"),
                fallback_title=meta.get("fallback_title"),
            )

        if cmd == "flow_abort":
            flow_id = str(params["flowId"])
            flow_kind = params.get("flowKind") or self._flow_kinds.get(flow_id, "config")
            self._manager_for(flow_id, flow_kind).async_abort(flow_id)
            self._flow_kinds.pop(flow_id, None)
            self._flow_meta.pop(flow_id, None)
            return {"aborted": True}

        if cmd == "flow_progress":
            return {"flows": await serialize_progress_flows(hass)}

        if cmd == "external_complete":
            return await self._cmd_external_complete(params)

        if cmd == "discovery_trigger":
            return await self._cmd_discovery_trigger(params)

        if cmd == "upload_file":
            filename = str(params["filename"])
            raise_if_invalid_filename(filename)
            raw_bytes = base64.b64decode(str(params["contentBase64"]))
            fud: file_upload.FileUploadData = hass.data[file_upload.DOMAIN]
            file_id = ulid_hex()
            target_dir = fud.file_dir(file_id)
            target_dir.mkdir(parents=True, exist_ok=True)
            (target_dir / filename).write_bytes(raw_bytes)
            fud.files[file_id] = filename
            return {"fileId": file_id, "filename": filename}

        if cmd == "application_credentials_list":
            coll = hass.data.get(application_credentials.DOMAIN)
            return {"items": list(coll.data.values()) if coll is not None else []}

        if cmd == "application_credentials_add":
            cred_domain = str(params["domain"])
            await self.state.installer.ensure_domain(hass, cred_domain)
            await application_credentials.async_import_client_credential(
                hass,
                cred_domain,
                application_credentials.ClientCredential(
                    client_id=str(params["clientId"]),
                    client_secret=str(params["clientSecret"]),
                    name=params.get("name"),
                ),
                auth_domain=params.get("authDomain"),
            )
            return {"ok": True}

        if cmd == "get_translations":
            language = str(params.get("language") or "en")
            categories = params.get("categories") or ["config", "options", "selector", "title"]
            integrations = params.get("integrations")
            merged: dict[str, str] = {}
            for cat in categories:
                merged.update(
                    await ha_translation.async_get_translations(
                        hass, language, str(cat), integrations
                    )
                )
            return {"translations": merged}

        if cmd == "list_flow_handlers":
            return {
                "handlers": sorted(
                    {
                        *generated_flows.FLOWS.get("integration", []),
                        *generated_flows.FLOWS.get("helper", []),
                    }
                )
            }

        if cmd == "setup_entry":
            orig_setup = hass.data.get("_haus_orig_async_setup") or hass.config_entries.async_setup
            return {"ok": bool(await orig_setup(str(params["entryId"])))}

        if cmd == "remove_entry":
            entry_id = str(params["entryId"])
            if hass.config_entries.async_get_entry(entry_id) is None:
                return {"removed": False}
            return {"removed": True, **dict(await hass.config_entries.async_remove(entry_id))}

        if cmd == "shutdown":
            return {"shutdown": True}

        raise ValueError(f"Unknown worker command: {cmd}")

    async def _cmd_flow_init(self, params: dict[str, Any]) -> dict[str, Any]:
        hass = self.state.hass
        domain = str(params["domain"])
        source = str(params.get("source") or "user")
        flow_kind = str(params.get("flowKind") or ("options" if source == "options" else "config"))
        entry_id = params.get("entryId")
        show_adv = bool(params.get("showAdvancedOptions", False))

        if flow_kind == "options":
            if not entry_id:
                raise ValueError("entryId is required for options flow")
            entry = hass.config_entries.async_get_entry(str(entry_id))
            if entry is None:
                raise ValueError(f"Unknown HA config entry: {entry_id}")
            await self.state.installer.ensure_domain(hass, entry.domain)
            with request_context(self.state):
                raw = await hass.config_entries.options.async_init(str(entry_id))
            fid = str(raw.get("flow_id") or "")
            if fid:
                self._flow_kinds[fid] = "options"
            return await serialize_flow_result(
                hass, dict(raw), mgr=hass.config_entries.options, flow_kind="options"
            )

        target_domain, virtual_domain, integration_title = await self._resolve_virtual_handler(domain)
        await self.state.installer.ensure_domain(hass, target_domain)
        context: dict[str, Any] = {"source": source, "show_advanced_options": show_adv}
        if virtual_domain:
            context["supported_by"] = virtual_domain
        if entry_id:
            context["entry_id"] = str(entry_id)
        with request_context(self.state):
            raw = await hass.config_entries.flow.async_init(
                target_domain,
                context=context,  # type: ignore[arg-type]
                data=params.get("data"),
            )
        fid = str(raw.get("flow_id") or "")
        if fid:
            self._flow_kinds[fid] = "config"
            self._flow_meta[fid] = {
                "virtual_domain": virtual_domain,
                "fallback_title": integration_title,
            }
        return await serialize_flow_result(
            hass,
            dict(raw),
            mgr=hass.config_entries.flow,
            flow_kind="config",
            virtual_domain=virtual_domain,
            fallback_title=integration_title,
        )

    async def _cmd_flow_configure(self, params: dict[str, Any]) -> dict[str, Any]:
        hass = self.state.hass
        flow_id = str(params["flowId"])
        flow_kind = str(params.get("flowKind") or self._flow_kinds.get(flow_id, "config"))
        mgr = self._manager_for(flow_id, flow_kind)
        with request_context(self.state):
            try:
                raw = await mgr.async_configure(flow_id, params.get("userInput"))
            except data_entry_flow.InvalidData as exc:
                return {"invalidData": True, "errors": dict(exc.schema_errors)}
        meta = self._flow_meta.get(flow_id, {})
        serialized = await serialize_flow_result(
            hass,
            dict(raw),
            mgr=mgr,
            flow_kind=flow_kind,
            virtual_domain=meta.get("virtual_domain"),
            fallback_title=meta.get("fallback_title"),
        )
        if serialized["flowResult"].get("type") in {"create_entry", "abort"}:
            self._flow_kinds.pop(flow_id, None)
            self._flow_meta.pop(flow_id, None)
        return serialized

    async def _cmd_external_complete(self, params: dict[str, Any]) -> dict[str, Any]:
        hass = self.state.hass
        raw_state = params.get("state")
        flow_id = str(params.get("flowId") or "")
        user_input: dict[str, Any] = {}
        if isinstance(raw_state, str):
            decoded_state = config_entry_oauth2_flow._decode_jwt(hass, raw_state)  # noqa: SLF001
            if decoded_state is None:
                raise ValueError("Invalid OAuth2 state token")
            flow_id = flow_id or str(decoded_state.get("flow_id") or "")
            user_input["state"] = decoded_state
        elif isinstance(raw_state, dict):
            user_input["state"] = raw_state
            flow_id = flow_id or str(raw_state.get("flow_id") or "")
        if not flow_id:
            raise ValueError("Missing flow_id in OAuth callback")
        if "code" in params and params["code"] is not None:
            user_input["code"] = params["code"]
        elif "error" in params and params["error"] is not None:
            user_input["error"] = params["error"]
        with request_context(self.state):
            raw = await hass.config_entries.flow.async_configure(flow_id, user_input)
        return await serialize_flow_result(
            hass, dict(raw), mgr=hass.config_entries.flow, flow_kind="config"
        )

    async def _cmd_discovery_trigger(self, params: dict[str, Any]) -> dict[str, Any]:
        status, raw = await trigger_discovery(
            self.state,
            domain=str(params["domain"]),
            protocol=str(params["protocol"]),
            info=dict(params.get("info") or {}),
            discovery_key=(str(params["discoveryKey"]) if params.get("discoveryKey") else None),
        )
        if status == "already_in_progress":
            return {"outcome": "already_in_progress"}
        assert raw is not None
        fid = str(raw.get("flow_id") or "")
        res_type = str(getattr(raw.get("type"), "value", raw.get("type") or ""))
        if fid and res_type not in {"create_entry", "abort"}:
            self._flow_kinds[fid] = "config"
        return {
            "outcome": res_type,
            **(
                await serialize_flow_result(
                    self.state.hass, raw, mgr=self.state.hass.config_entries.flow, flow_kind="config"
                )
            ),
        }


def _write_response(obj: dict[str, Any]) -> None:
    try:
        line = json_dumps(obj)
    except Exception:
        line = json.dumps(obj, cls=ExtendedJSONEncoder)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


async def _serve(args: dict[str, Any]) -> int:
    state = await create_headless_hass(
        config_dir=args["configDir"],
        deps_dir=args["depsDir"],
        frontend_base=args.get("frontendBase", "http://127.0.0.1:8123"),
        components_overlay_dir=args.get("componentsOverlayDir"),
        auto_install_reqs=args.get("autoInstallReqs"),
        setup_on_create=bool(args.get("setupOnCreate", False)),
    )
    worker = HaFlowWorker(state)
    _write_response({"event": "ready", "haVersion": pkg_version("homeassistant")})

    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)

    try:
        while raw_line := await reader.readline():
            line = raw_line.decode("utf-8").strip()
            if not line:
                continue
            req_id: Any = None
            try:
                msg = json.loads(line)
                req_id = msg.get("id")
                cmd = str(msg.get("cmd") or "")
                result = await worker.handle_command(cmd, msg.get("params") or {})
                _write_response({"id": req_id, "ok": True, "result": result})
                if cmd == "shutdown":
                    break
            except MissingRequirementsError as err:
                _write_response(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": {
                            "code": "missing_requirements",
                            "message": str(err),
                            "domain": err.domain,
                            "missingRequirements": err.missing,
                        },
                    }
                )
            except (data_entry_flow.UnknownFlow, data_entry_flow.UnknownHandler) as err:
                _write_response(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": {"code": type(err).__name__, "message": str(err)},
                    }
                )
            except Exception as err:
                _write_response(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": {
                            "code": type(err).__name__,
                            "message": str(err),
                            "traceback": traceback.format_exc(limit=8),
                        },
                    }
                )
    finally:
        await state.hass.async_stop()
    return 0


def main() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    return asyncio.run(
        _serve(
            {
                "configDir": sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HA_FLOW_CONFIG_DIR", "./ha-flow-config"),
                "depsDir": sys.argv[2] if len(sys.argv) > 2 else os.environ.get("HA_FLOW_DEPS_DIR", "./ha-deps"),
                "frontendBase": os.environ.get("HA_FLOW_FRONTEND_BASE", "http://127.0.0.1:8123"),
                "componentsOverlayDir": os.environ.get("HA_FLOW_COMPONENTS_DIR"),
                "setupOnCreate": os.environ.get("HA_FLOW_SETUP_ON_CREATE", "false").lower() == "true",
            }
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
