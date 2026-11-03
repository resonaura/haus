"""Run against HA's installed Python environment without starting an integration."""

import importlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.exceptions import HomeAssistantError

# Pass the staged package directory name; this never imports the live integration.
PACKAGE = sys.argv.pop(1) if len(sys.argv) > 1 else "haus_native_adapter_check"
sys.path.insert(0, "/tmp")
base = importlib.import_module(f"{PACKAGE}.native")


class NativeEntitiesTest(unittest.IsolatedAsyncioTestCase):
    async def test_capabilities_commands_and_offline(self):
        definitions = [
            {
                "id": "light",
                "name": "Spotlight",
                "domain": "light",
                "writable": True,
                "available": True,
                "brightness": True,
                "state": {"on": True, "brightness": 50},
            },
            {
                "id": "haus_activity",
                "name": "Activity",
                "domain": "binary_sensor",
                "available": True,
                "state": False,
                "deviceClass": "motion",
                "role": "motion",
            },
            {
                "id": "sd",
                "name": "SD",
                "domain": "sensor",
                "available": False,
                "state": None,
                "unit": "%",
            },
            {
                "id": "switch",
                "name": "Detection",
                "domain": "switch",
                "writable": True,
                "available": True,
                "state": True,
            },
            {
                "id": "volume",
                "name": "Volume",
                "domain": "number",
                "writable": True,
                "available": True,
                "state": 0,
                "min": 0,
                "max": 100,
                "step": 1,
            },
            {
                "id": "mode",
                "name": "Mode",
                "domain": "select",
                "writable": True,
                "available": True,
                "state": "auto",
                "options": ["off", "auto"],
            },
            {
                "id": "stop",
                "name": "Stop",
                "domain": "button",
                "writable": True,
                "available": True,
                "state": None,
            },
        ]
        device = {
            "bridgeId": "bridge",
            "physicalId": "physical",
            "deviceId": "existing",
            "name": "Camera",
            "manufacturer": "Aqara",
            "model": "G5 Pro",
            "entities": definitions,
        }
        coordinator = SimpleNamespace(
            hass=object(),
            last_update_success=True,
            data={"camera.one": {"native_entities": device}},
            async_request_refresh=AsyncMock(),
        )
        client = SimpleNamespace(command=AsyncMock())
        entry = SimpleNamespace(unique_id="stable-entry")
        dr = SimpleNamespace(
            async_get=lambda _: SimpleNamespace(identifiers={("mqtt", "real-physical")})
        )
        er = SimpleNamespace(async_get=lambda _: None)
        classes = {
            "light": "HausLight",
            "binary_sensor": "HausBinarySensor",
            "sensor": "HausSensor",
            "switch": "HausSwitch",
            "number": "HausNumber",
            "select": "HausSelect",
            "button": "HausButton",
        }
        entities = {}
        with (
            patch.object(base.dr, "async_get", return_value=dr),
            patch.object(base.er, "async_get", return_value=er),
        ):
            for definition in definitions:
                module = importlib.import_module(f"{PACKAGE}.{definition['domain']}")
                cls = getattr(module, classes[definition["domain"]])
                entities[definition["id"]] = cls(
                    coordinator, client, entry, "camera.one", definition
                )
        light = entities["light"]
        self.assertEqual(light.brightness, 128)
        self.assertFalse(entities["haus_activity"].is_on)
        self.assertEqual(
            entities["haus_activity"].extra_state_attributes["haus_activity_version"], 1
        )
        self.assertIsNone(entities["sd"].native_value)
        self.assertFalse(entities["sd"].available)
        self.assertEqual(entities["volume"].native_value, 0)
        self.assertEqual(light.device_info["identifiers"], {("mqtt", "real-physical")})
        await light.async_turn_on(brightness=102)
        self.assertEqual(
            client.command.call_args.args,
            (
                "camera.one",
                "light",
                {"action": "set", "value": {"on": True, "brightness": 40}},
            ),
        )
        await entities["mode"].async_select_option("off")
        await entities["stop"].async_press()
        self.assertEqual(client.command.call_args.args[2], {"action": "press"})
        self.assertEqual(coordinator.async_request_refresh.await_count, 3)
        definitions[0]["available"] = False
        with self.assertRaises(HomeAssistantError):
            await light.async_turn_off()
        self.assertEqual(client.command.await_count, 3)
        device["entities"] = []
        self.assertFalse(entities["volume"].available)
        self.assertEqual(entities["volume"].native_max_value, 100)


if __name__ == "__main__":
    unittest.main()
