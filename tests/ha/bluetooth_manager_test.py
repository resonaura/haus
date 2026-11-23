# SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov.
"""Verify headless HA Bluetooth manager never probes Linux HCI mgmt sockets."""

import importlib.util
import logging
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import habluetooth
import habluetooth.manager as habluetooth_manager
from homeassistant.core import HomeAssistant

_TRANSPORTS_PATH = (
    pathlib.Path(__file__).resolve().parent.parent.parent / "packages" / "kitsune" / "src" / "ha-flow" / "transports.py"
)
_SPEC = importlib.util.spec_from_file_location("haus_ha_flow_transports", _TRANSPORTS_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_TRANSPORTS = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_TRANSPORTS)


class HeadlessBluetoothManagerTest(unittest.IsolatedAsyncioTestCase):
    async def test_skips_linux_mgmt_socket_probe_and_avoids_net_admin_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="haus-bt-test-") as tmp:
            hass = HomeAssistant(tmp)
            prev_is_linux = habluetooth_manager.IS_LINUX
            prev_manager = getattr(habluetooth.central_manager, "CentralBluetoothManager", None)
            prev_central = prev_manager.manager if prev_manager is not None else None
            try:
                habluetooth_manager.IS_LINUX = True
                if prev_manager is not None:
                    prev_manager.manager = None

                with (
                    patch.object(
                        habluetooth_manager,
                        "MGMTBluetoothCtl",
                        side_effect=PermissionError("Missing NET_ADMIN/NET_RAW"),
                    ) as mock_mgmt,
                    self.assertNoLogs("habluetooth.manager", level=logging.ERROR),
                ):
                    await _TRANSPORTS._setup_bluetooth_manager(hass)

                mock_mgmt.assert_not_called()
                manager = habluetooth.get_manager()
                self.assertFalse(manager.is_operating_degraded())
                self.assertTrue(habluetooth_manager.IS_LINUX)
                manager.async_stop()
            finally:
                habluetooth_manager.IS_LINUX = prev_is_linux
                if prev_manager is not None:
                    prev_manager.manager = prev_central
