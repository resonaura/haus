#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
import asyncio
import json
import os
import sys
import types

# Optional POSIX resource limits
try:
    import resource

    # Limit memory to 512MB by default if requested via env
    max_mem_mb = int(os.environ.get("HAUS_PYTHON_MAX_MEM_MB", "512"))
    if max_mem_mb > 0:
        mem_bytes = max_mem_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    # CPU time limit in seconds
    max_cpu_sec = int(os.environ.get("HAUS_PYTHON_MAX_CPU_SEC", "120"))
    if max_cpu_sec > 0:
        resource.setrlimit(resource.RLIMIT_CPU, (max_cpu_sec, max_cpu_sec))
except Exception:
    pass


def send_rpc(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def send_event(method, params):
    send_rpc({"jsonrpc": "2.0", "method": method, "params": params})


def send_response(req_id, result=None, error=None):
    payload = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        payload["error"] = error
    else:
        payload["result"] = result
    send_rpc(payload)


# Mock Home Assistant Core Environment
class MockEventBus:
    def __init__(self):
        self._listeners = {}

    def async_listen(self, event_type, target):
        self._listeners.setdefault(event_type, []).append(target)

    def async_fire(self, event_type, event_data=None):
        for target in self._listeners.get(event_type, []):
            try:
                if asyncio.iscoroutinefunction(target):
                    asyncio.create_task(target(event_data))
                else:
                    target(event_data)
            except Exception:
                pass


class MockServiceRegistry:
    def __init__(self):
        self._services = {}

    def async_register(self, domain, service, service_func, schema=None):
        self._services[(domain, service)] = service_func

    async def async_call(self, domain, service, service_data=None, blocking=True):
        func = self._services.get((domain, service))
        if func:
            call_obj = types.SimpleNamespace(domain=domain, service=service, data=service_data or {})
            if asyncio.iscoroutinefunction(func):
                return await func(call_obj)
            return func(call_obj)
        return None


class MockStates:
    def __init__(self):
        self._states = {}

    def async_set(self, entity_id, state, attributes=None):
        self._states[entity_id] = {"state": state, "attributes": attributes or {}}
        send_event("entity_updated", {"entityId": entity_id, "state": state, "attributes": attributes or {}})

    def get(self, entity_id):
        s = self._states.get(entity_id)
        if s:
            return types.SimpleNamespace(state=s["state"], attributes=s["attributes"])
        return None


class MockHomeAssistant:
    def __init__(self):
        self.bus = MockEventBus()
        self.services = MockServiceRegistry()
        self.states = MockStates()
        self.data = {}
        self.loop = asyncio.get_event_loop()

    def async_create_task(self, target):
        return asyncio.create_task(target)

    def async_add_executor_job(self, target, *args):
        return self.loop.run_in_executor(None, target, *args)


class MockConfigEntry:
    def __init__(self, entry_id, domain, data, options=None):
        self.entry_id = entry_id
        self.domain = domain
        self.data = data
        self.options = options or {}
        self.title = domain


class MockDataUpdateCoordinator:
    def __init__(self, hass, logger=None, name=None, update_interval=None, update_method=None):
        self.hass = hass
        self.name = name or "coordinator"
        self.update_interval = update_interval
        self.update_method = update_method
        self.data = None
        self._listeners = []

    def async_add_listener(self, update_callback):
        self._listeners.append(update_callback)

    def async_set_updated_data(self, data):
        self.data = data
        for cb in self._listeners:
            try:
                cb()
            except Exception:
                pass


class MockEntity:
    def __init__(self):
        self.hass = None
        self.entity_id = None
        self.name = None
        self.unique_id = None
        self._state = None
        self._attributes = {}

    @property
    def state(self):
        return self._state

    @property
    def extra_state_attributes(self):
        return self._attributes

    def async_write_ha_state(self):
        if self.hass and self.entity_id:
            val = getattr(self, "is_on", None)
            if val is not None:
                self._state = "on" if val else "off"
            elif hasattr(self, "state"):
                self._state = self.state
            attrs = dict(self.extra_state_attributes) if self.extra_state_attributes else {}
            if hasattr(self, "current_temperature"):
                attrs["current_temperature"] = self.current_temperature
            self.hass.states.async_set(self.entity_id, self._state, attrs)


# Setup global mock modules in sys.modules
def install_mock_ha(hass_instance):
    ha_pkg = types.ModuleType("homeassistant")
    core_mod = types.ModuleType("homeassistant.core")
    core_mod.HomeAssistant = MockHomeAssistant
    core_mod.callback = lambda f: f

    config_entries_mod = types.ModuleType("homeassistant.config_entries")
    config_entries_mod.ConfigEntry = MockConfigEntry

    helpers_mod = types.ModuleType("homeassistant.helpers")
    update_coordinator_mod = types.ModuleType("homeassistant.helpers.update_coordinator")
    update_coordinator_mod.DataUpdateCoordinator = MockDataUpdateCoordinator
    update_coordinator_mod.CoordinatorEntity = MockEntity

    entity_mod = types.ModuleType("homeassistant.helpers.entity")
    entity_mod.Entity = MockEntity

    issue_registry_mod = types.ModuleType("homeassistant.helpers.issue_registry")

    def async_create_issue(
        hass, domain, issue_id, is_fixable=False, severity="warning", translation_key=None, **kwargs
    ):
        send_event(
            "issue_created",
            {
                "issueId": f"{domain}_{issue_id}",
                "domain": domain,
                "severity": severity,
                "translationKey": translation_key or issue_id,
            },
        )

    issue_registry_mod.async_create_issue = async_create_issue

    notif_mod = types.ModuleType("homeassistant.components.persistent_notification")

    def async_create_notification(hass, message, title=None, notification_id=None):
        send_event(
            "persistent_notification",
            {"notificationId": notification_id or "notif", "title": title or "Notification", "message": message},
        )

    notif_mod.async_create = async_create_notification

    sys.modules["homeassistant"] = ha_pkg
    sys.modules["homeassistant.core"] = core_mod
    sys.modules["homeassistant.config_entries"] = config_entries_mod
    sys.modules["homeassistant.helpers"] = helpers_mod
    sys.modules["homeassistant.helpers.update_coordinator"] = update_coordinator_mod
    sys.modules["homeassistant.helpers.entity"] = entity_mod
    sys.modules["homeassistant.helpers.issue_registry"] = issue_registry_mod
    sys.modules["homeassistant.components.persistent_notification"] = notif_mod


async def main():
    hass = MockHomeAssistant()
    install_mock_ha(hass)
    active_entries = {}

    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        text = line.strip()
        if not text:
            continue
        try:
            req = json.loads(text)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "setup_entry":
            domain = params.get("domain")
            entry_id = params.get("entryId")
            data = params.get("data", {})
            options = params.get("options", {})
            entry = MockConfigEntry(entry_id, domain, data, options)
            active_entries[entry_id] = entry
            send_response(req_id, {"status": "ok", "entryId": entry_id, "domain": domain})

        elif method == "register_entity":
            entity_id = params.get("entityId")
            domain = params.get("domain") or (entity_id.split(".")[0] if "." in entity_id else "unknown")
            unique_id = params.get("uniqueId")
            name = params.get("name") or entity_id
            state = params.get("state")
            attrs = params.get("attributes", {})
            hass.states.async_set(entity_id, state, attrs)
            send_event(
                "entity_added",
                {
                    "entityId": entity_id,
                    "domain": domain,
                    "uniqueId": unique_id,
                    "name": name,
                    "state": state,
                    "attributes": attrs,
                },
            )
            send_response(req_id, {"status": "ok", "entityId": entity_id})

        elif method == "call_service":
            domain = params.get("domain")
            service = params.get("service")
            data = params.get("serviceData", {})
            try:
                res = await hass.services.async_call(domain, service, data)
                send_response(req_id, {"status": "ok", "result": res})
            except Exception as e:
                send_response(req_id, error={"code": -32000, "message": str(e)})

        elif method == "unload_entry":
            entry_id = params.get("entryId")
            active_entries.pop(entry_id, None)
            send_response(req_id, {"status": "ok", "unloaded": entry_id})

        elif method == "ping":
            send_response(req_id, "pong")

        else:
            send_response(req_id, error={"code": -32601, "message": f"Method {method} not found"})


if __name__ == "__main__":
    asyncio.run(main())
