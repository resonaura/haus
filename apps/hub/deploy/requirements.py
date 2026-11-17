# SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov.
"""List the requirements of a Home Assistant integration and its required dependencies."""

import json
from pathlib import Path
import sys

import homeassistant


def requirements(domains: list[str]) -> list[str]:
    root = Path(homeassistant.__file__).parent / "components"
    pending = list(domains)
    seen = set()
    packages = set()
    while pending:
        domain = pending.pop()
        if domain in seen:
            continue
        seen.add(domain)
        manifest = json.loads((root / domain / "manifest.json").read_text())
        pending.extend(manifest.get("dependencies", []))
        packages.update(manifest.get("requirements", []))
    return sorted(packages)


if __name__ == "__main__":
    print("\n".join(requirements(sys.argv[1:])))
