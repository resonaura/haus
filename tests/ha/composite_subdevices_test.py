# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""Tests for hardware-composite sub-device folding in ha-flow."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace


def _load_subentries():
    path = Path(__file__).resolve().parents[2] / "packages" / "kitsune" / "src" / "ha-flow" / "subentries.py"
    spec = importlib.util.spec_from_file_location("haus_ha_flow_subentries", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeDeviceRegistry:
    def __init__(self, devices: list[SimpleNamespace]) -> None:
        self._by_id = {d.id: d for d in devices}

    def async_get(self, device_id: str) -> SimpleNamespace | None:
        return self._by_id.get(device_id)


def _dev(**kwargs) -> SimpleNamespace:
    defaults = {
        "id": "dev",
        "name": "Device",
        "name_by_user": None,
        "manufacturer": None,
        "model": None,
        "entry_type": None,
        "via_device_id": None,
        "config_entries": set(),
        "primary_config_entry": None,
        "identifiers": set(),
        "area_id": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_folds_meross_and_tplink_power_strip_channels_into_parent() -> None:
    subentries = _load_subentries()
    meross_parent = _dev(
        id="parent-strip",
        name="Power strip",
        name_by_user="Bedroom Desk Surge Protector",
        manufacturer="Meross",
        model="mss425f-eu",
        primary_config_entry="entry-meross",
        identifiers={("meross_lan", "24040236512493540601c4e7ae00edef")},
        area_id="bedroom",
    )
    meross_channel = _dev(
        id="child-ch-2",
        name="Power strip Channel 2",
        manufacturer="Meross",
        model="mss425f-eu",
        via_device_id="parent-strip",
        primary_config_entry="entry-meross",
        identifiers={("meross_lan", "24040236512493540601c4e7ae00edef_2")},
    )
    kasa_parent = _dev(
        id="kasa-hs300",
        name="Desk Strip",
        manufacturer="TP-Link",
        model="HS300",
        primary_config_entry="entry-tplink",
        identifiers={("tplink", "AA:BB:CC:DD:EE:FF")},
    )
    kasa_plug = _dev(
        id="kasa-hs300-plug1",
        name="Monitor",
        manufacturer="TP-Link",
        model="HS300",
        via_device_id="kasa-hs300",
        primary_config_entry="entry-tplink",
        identifiers={("tplink", "AA:BB:CC:DD:EE:FF_01")},
    )
    reg = _FakeDeviceRegistry([meross_parent, meross_channel, kasa_parent, kasa_plug])

    assert subentries.resolve_canonical_device(meross_channel, reg) is meross_parent
    assert subentries.resolve_canonical_device(kasa_plug, reg) is kasa_parent


def test_never_folds_bridges_network_services_or_mesh_satellites() -> None:
    subentries = _load_subentries()
    hue_bridge = _dev(
        id="hue-bridge",
        name="Hue Bridge",
        manufacturer="Signify Netherlands B.V.",
        model="Hue Bridge",
        primary_config_entry="entry-hue",
        identifiers={("hue", "bridge-1")},
    )
    hue_bulb = _dev(
        id="hue-bulb",
        name="Hallway Bulb 1",
        manufacturer="Signify Netherlands B.V.",
        model="Hue color lamp",
        via_device_id="hue-bridge",
        primary_config_entry="entry-hue",
        identifiers={("hue", "bulb-uuid-1")},
    )
    eero_net = _dev(
        id="eero-net",
        name="Crawford",
        manufacturer="eero",
        model="Network",
        entry_type="service",
        primary_config_entry="entry-eero",
        identifiers={("eero", "net-1")},
    )
    eero_node = _dev(
        id="eero-node",
        name="Narnia",
        manufacturer="eero",
        model="eero 6",
        via_device_id="eero-net",
        primary_config_entry="entry-eero",
        identifiers={("eero", "net-1_node")},
    )
    eero_sat = _dev(
        id="eero-sat",
        name="Bedroom eero",
        manufacturer="eero",
        model="eero 6",
        via_device_id="eero-node",
        primary_config_entry="entry-eero",
        identifiers={("eero", "net-1_node_2")},
    )
    reg = _FakeDeviceRegistry([hue_bridge, hue_bulb, eero_net, eero_node, eero_sat])

    assert subentries.resolve_canonical_device(hue_bulb, reg) is hue_bulb
    assert subentries.resolve_canonical_device(eero_node, reg) is eero_node
    assert subentries.resolve_canonical_device(eero_sat, reg) is eero_sat


def test_resolve_canonical_device_never_touches_deprecated_config_entries() -> None:
    """HA 2026 raises when code accesses deprecated `config_entries` or `primary_config_entry`."""
    subentries = _load_subentries()

    class _Ha2026Device:
        def __init__(self, **kwargs: object) -> None:
            for key, value in kwargs.items():
                setattr(self, key, value)

        @property
        def config_entries(self) -> set[str]:
            raise RuntimeError("DeviceEntry.config_entries is deprecated; use config_entry_id")

        @property
        def primary_config_entry(self) -> str:
            raise RuntimeError("DeviceEntry.primary_config_entry is deprecated; use config_entry_id")

    parent = _Ha2026Device(
        id="strip-parent",
        name="Bedroom Desk Surge Protector",
        name_by_user=None,
        manufacturer="Meross",
        model="mss425f-eu",
        via_device_id=None,
        entry_type=None,
        config_entry_id="entry-meross",
        identifiers={("meross_lan", "24040236512493540601c4e7ae00edef")},
    )
    child = _Ha2026Device(
        id="strip-ch-1",
        name="Power strip Channel 1",
        name_by_user=None,
        manufacturer="Meross",
        model="mss425f-eu",
        via_device_id="strip-parent",
        entry_type=None,
        config_entry_id="entry-meross",
        identifiers={("meross_lan", "24040236512493540601c4e7ae00edef_1")},
    )
    reg = _FakeDeviceRegistry([parent, child])
    assert subentries.resolve_canonical_device(child, reg) is parent
