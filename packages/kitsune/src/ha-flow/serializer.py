# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Serialize Home Assistant FlowResult and translations cleanly into Haus payloads."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import voluptuous_serialize

from homeassistant import config_entries, data_entry_flow
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, translation as ha_translation


def _entry_fragment_dict(entry_obj: config_entries.ConfigEntry) -> dict[str, Any]:
    frag = entry_obj.as_json_fragment
    if isinstance(frag, dict):
        return dict(frag)
    contents = getattr(frag, "contents", None)
    if isinstance(contents, (bytes, bytearray, str)):
        return dict(json.loads(contents))
    return {
        "entry_id": entry_obj.entry_id,
        "domain": entry_obj.domain,
        "title": entry_obj.title,
        "source": entry_obj.source,
        "state": str(getattr(entry_obj.state, "value", entry_obj.state)),
        "disabled_by": (
            str(entry_obj.disabled_by.value) if entry_obj.disabled_by else None
        ),
        "supports_options": entry_obj.supports_options,
        "supports_remove_device": entry_obj.supports_remove_device,
        "supports_unload": entry_obj.supports_unload,
        "supports_reconfigure": entry_obj.supports_reconfigure,
        "pref_disable_new_entities": entry_obj.pref_disable_new_entities,
        "pref_disable_polling": entry_obj.pref_disable_polling,
        "reason": entry_obj.reason,
    }


def interpolate(template: str | None, placeholders: dict[str, Any] | None) -> str | None:
    """Substitute Home Assistant {placeholder} tokens into translation strings."""
    if not template:
        return None
    if not placeholders:
        return template
    result = template
    for key, value in placeholders.items():
        result = result.replace(f"{{{key}}}", str(value))
    return result


async def serialize_flow_result(
    hass: HomeAssistant,
    raw_result: dict[str, Any],
    *,
    mgr: Any,
    flow_kind: str = "config",
    virtual_domain: str | None = None,
    fallback_title: str | None = None,
) -> dict[str, Any]:
    """Convert raw HA FlowResult to JSON-safe result + resolved English HA strings."""
    res = dict(raw_result)
    res_type = str(getattr(res.get("type"), "value", res.get("type") or ""))
    res["type"] = res_type
    handler = str(res.get("handler") or "")
    flow_id = str(res.get("flow_id") or "")
    step_id = str(res.get("step_id") or "")
    translation_domain = str(res.get("translation_domain") or handler)
    category = "options" if flow_kind == "options" else "config"

    if "data_schema" in res:
        schema = res["data_schema"]
        if schema is None:
            res["data_schema"] = []
        else:
            res["data_schema"] = voluptuous_serialize.convert(
                schema, custom_serializer=cv.custom_serializer
            )

    created_entry: dict[str, Any] | None = None
    ctx = res.get("context") if isinstance(res.get("context"), dict) else {}
    ctx_entry_id = ctx.get("entry_id")
    if res_type == data_entry_flow.FlowResultType.CREATE_ENTRY.value:
        entry_obj = res.get("result")
        if not isinstance(entry_obj, config_entries.ConfigEntry) and ctx_entry_id:
            entry_obj = hass.config_entries.async_get_entry(str(ctx_entry_id))
        if isinstance(entry_obj, config_entries.ConfigEntry):
            fragment = _entry_fragment_dict(entry_obj)
            created_entry = {
                **fragment,
                "data": dict(entry_obj.data),
                "options": dict(entry_obj.options),
                "unique_id": entry_obj.unique_id,
                "version": entry_obj.version,
                "minor_version": entry_obj.minor_version,
                "source": entry_obj.source,
            }
            res["result"] = fragment
        res.pop("data", None)
        res.pop("context", None)
    elif res_type == data_entry_flow.FlowResultType.ABORT.value and ctx_entry_id and str(
        res.get("reason") or ""
    ) in {"reauth_successful", "reconfigure_successful"}:
        entry_obj = hass.config_entries.async_get_entry(str(ctx_entry_id))
        if isinstance(entry_obj, config_entries.ConfigEntry):
            fragment = _entry_fragment_dict(entry_obj)
            created_entry = {
                **fragment,
                "data": dict(entry_obj.data),
                "options": dict(entry_obj.options),
                "unique_id": entry_obj.unique_id,
                "version": entry_obj.version,
                "minor_version": entry_obj.minor_version,
                "source": entry_obj.source,
            }

    domains_to_load = [
        d for d in {handler, translation_domain, virtual_domain or "", "homeassistant"} if d
    ]
    step_tr, sel_tr, title_tr = await asyncio.gather(
        ha_translation.async_get_translations(hass, "en", category, domains_to_load),
        ha_translation.async_get_translations(hass, "en", "selector", domains_to_load),
        ha_translation.async_get_translations(hass, "en", "title", domains_to_load),
    )

    tr_dom = translation_domain if flow_kind != "options" else handler
    placeholders = res.get("description_placeholders") or {}
    if not isinstance(placeholders, dict):
        placeholders = {}

    progress_ctx: dict[str, Any] = {}
    for item in mgr.async_progress():
        if item.get("flow_id") == flow_id:
            progress_ctx = dict(item.get("context") or {})
            break

    step_prefix = f"component.{tr_dom}.{category}.step.{step_id}"
    flow_title_tpl = step_tr.get(f"component.{tr_dom}.{category}.flow_title")
    title_placeholders = progress_ctx.get("title_placeholders") or {}
    title = (
        (title_tr.get(f"component.{virtual_domain}.title") if virtual_domain else None)
        or title_tr.get(f"component.{handler}.title")
        or fallback_title
        or handler
    )
    flow_title_raw = interpolate(flow_title_tpl, title_placeholders)
    # Only surface flow_title if every placeholder was resolved; otherwise keep integration title.
    flow_title = (
        flow_title_raw
        if flow_title_raw and "{" not in flow_title_raw and "}" not in flow_title_raw
        else None
    )
    step_title = interpolate(step_tr.get(f"{step_prefix}.title"), placeholders)
    step_desc = interpolate(step_tr.get(f"{step_prefix}.description"), placeholders)
    submit_label = step_tr.get(f"{step_prefix}.submit")

    field_labels: dict[str, str] = {}
    data_descriptions: dict[str, str] = {}
    data_prefix = f"{step_prefix}.data."
    desc_prefix = f"{step_prefix}.data_description."
    sec_prefix = f"{step_prefix}.sections."
    for key, val in step_tr.items():
        if key.startswith(data_prefix):
            field_labels[key[len(data_prefix) :]] = val
        elif key.startswith(desc_prefix):
            data_descriptions[key[len(desc_prefix) :]] = val
        elif key.startswith(sec_prefix):
            rest = key[len(sec_prefix) :]
            parts = rest.split(".")
            if len(parts) >= 3 and parts[1] == "data":
                field_labels[f"{parts[0]}.{'.'.join(parts[2:])}"] = val
            elif len(parts) >= 3 and parts[1] == "data_description":
                data_descriptions[f"{parts[0]}.{'.'.join(parts[2:])}"] = val
            elif len(parts) == 2 and parts[1] == "name":
                field_labels[parts[0]] = val
            elif len(parts) == 2 and parts[1] == "description":
                data_descriptions[parts[0]] = val

    translated_errors: dict[str, str] = {}
    raw_errors = res.get("errors") or {}
    if isinstance(raw_errors, dict):
        for fld, code in raw_errors.items():
            translated_errors[str(fld)] = (
                step_tr.get(f"component.{tr_dom}.{category}.error.{code}")
                or step_tr.get(f"component.homeassistant.{category}.error.{code}")
                or str(code)
            )

    abort_reason: str | None = None
    if res_type == data_entry_flow.FlowResultType.ABORT.value and res.get("reason"):
        reason = str(res["reason"])
        abort_reason = (
            interpolate(
                step_tr.get(f"component.{tr_dom}.{category}.abort.{reason}")
                or step_tr.get(f"component.homeassistant.{category}.abort.{reason}"),
                placeholders,
            )
            or reason
        )

    menu_options_map: dict[str, str] = {}
    menu_descriptions_map: dict[str, str] = {}
    if isinstance(res.get("menu_options"), (list, dict)):
        raw_opts = res["menu_options"]
        opt_keys = (
            list(raw_opts.keys())
            if isinstance(raw_opts, dict)
            else [str(o) for o in raw_opts]
        )
        for opt in opt_keys:
            fallback_opt = str(raw_opts[opt]) if isinstance(raw_opts, dict) else opt
            menu_options_map[opt] = (
                step_tr.get(f"{step_prefix}.menu_options.{opt}") or fallback_opt
            )
            desc_opt = step_tr.get(f"{step_prefix}.menu_option_descriptions.{opt}")
            if desc_opt:
                menu_descriptions_map[opt] = desc_opt

    return {
        "flowResult": res,
        "entry": created_entry,
        "localized": {
            "title": flow_title or title,
            "integrationTitle": title,
            "flowTitle": flow_title,
            "stepTitle": step_title,
            "description": step_desc,
            "submitLabel": submit_label,
            "fieldLabels": field_labels,
            "dataDescriptions": data_descriptions,
            "errors": translated_errors,
            "abortReason": abort_reason,
            "menuOptions": menu_options_map,
            "menuOptionDescriptions": menu_descriptions_map,
            "selectorTranslations": sel_tr,
            "supportedBy": virtual_domain,
        },
        "context": {k: v for k, v in progress_ctx.items() if k != "discovery_key"},
    }


async def serialize_progress_flows(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Serialize active non-user Home Assistant discovery/reauth flows."""
    items = [
        item
        for item in hass.config_entries.flow.async_progress()
        if (item.get("context") or {}).get("source") != config_entries.SOURCE_USER
    ]
    handlers = list({str(item.get("handler") or "") for item in items if item.get("handler")})
    cfg_tr, tit_tr = (
        await asyncio.gather(
            ha_translation.async_get_translations(hass, "en", "config", handlers),
            ha_translation.async_get_translations(hass, "en", "title", handlers),
        )
        if handlers
        else ({}, {})
    )
    enriched: list[dict[str, Any]] = []
    for item in items:
        handler = str(item.get("handler") or "")
        ctx = dict(item.get("context") or {})
        ctx.pop("discovery_key", None)
        tpl = cfg_tr.get(f"component.{handler}.config.flow_title")
        title = (
            interpolate(tpl, ctx.get("title_placeholders"))
            or tit_tr.get(f"component.{handler}.title")
            or handler
        )
        enriched.append(
            {
                "flow_id": item.get("flow_id"),
                "handler": handler,
                "step_id": item.get("step_id"),
                "context": ctx,
                "title": title,
            }
        )
    return enriched
