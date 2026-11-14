# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""On-demand dependency resolver for Home Assistant integration flows."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
import importlib
import importlib.metadata
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant import loader, requirements as ha_requirements
from homeassistant.util import package as pkg_util

_LOGGER = logging.getLogger(__name__)


class MissingRequirementsError(Exception):
    """Raised when an integration requires uninstalled PyPI packages."""

    def __init__(self, domain: str, missing: list[str], reason: str | None = None) -> None:
        self.domain = domain
        self.missing = missing
        detail = reason or f"Missing Python requirements for {domain}: {', '.join(missing)}"
        super().__init__(detail)


def _parse_bool_env(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


class HaRequirementsInstaller:
    """Install integration PyPI requirements on demand using uv/pip into deps_dir."""

    def __init__(
        self,
        deps_dir: str | Path,
        *,
        auto_install: bool | None = None,
        uv_bin: str | None = None,
        timeout: int = 120,
    ) -> None:
        self.deps_dir = Path(deps_dir).resolve()
        self.deps_dir.mkdir(parents=True, exist_ok=True)
        self.auto_install = (
            _parse_bool_env("HAUS_HA_AUTO_INSTALL_REQS", True)
            if auto_install is None
            else auto_install
        )
        self.uv_bin = uv_bin or self._resolve_uv_bin()
        self.timeout = timeout
        self._lock = asyncio.Lock()
        self._verified_domains: set[str] = set()
        self._installed_cache: set[str] = set()
        self.ensure_sys_path()

    @staticmethod
    def _resolve_uv_bin() -> str | None:
        candidates = [
            os.environ.get("HAUS_UV_BIN"),
            shutil.which("uv"),
            str(Path.home() / ".local" / "bin" / "uv"),
            "/usr/local/bin/uv",
        ]
        for candidate in candidates:
            if candidate and Path(candidate).is_file():
                return candidate
        return None

    def ensure_sys_path(self) -> None:
        """Ensure deps_dir takes precedence on sys.path and invalidate finder caches."""
        deps_str = str(self.deps_dir)
        if deps_str not in sys.path:
            sys.path.insert(0, deps_str)
        importlib.invalidate_caches()

    def is_requirement_satisfied(self, requirement_str: str) -> bool:
        """Check whether requirement_str is currently importable in sys.path."""
        if requirement_str in self._installed_cache:
            return True
        self.ensure_sys_path()
        if pkg_util.is_installed(requirement_str):
            self._installed_cache.add(requirement_str)
            return True
        return False

    def _build_install_cmd(self, specs: list[str], *, use_constraints: bool) -> list[str]:
        constraints_path = Path(ha_requirements.__file__).with_name(
            ha_requirements.CONSTRAINT_FILE
        )
        constraint_args = (
            ["--constraint", str(constraints_path)]
            if use_constraints and constraints_path.is_file()
            else []
        )
        has_uv_mod = importlib.util.find_spec("uv") is not None
        if has_uv_mod:
            return [
                sys.executable,
                "-m",
                "uv",
                "pip",
                "install",
                "--quiet",
                "--index-strategy",
                "unsafe-first-match",
                "--target",
                str(self.deps_dir),
                *constraint_args,
                *specs,
            ]
        if self.uv_bin:
            return [
                self.uv_bin,
                "pip",
                "install",
                "--quiet",
                "--python",
                sys.executable,
                "--index-strategy",
                "unsafe-first-match",
                "--target",
                str(self.deps_dir),
                *constraint_args,
                *specs,
            ]
        return [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--quiet",
            "--disable-pip-version-check",
            "--target",
            str(self.deps_dir),
            *constraint_args,
            *specs,
        ]

    def _install_sync(self, domain: str, missing: list[str], is_custom: bool) -> None:
        env = os.environ.copy()
        env["HTTP_TIMEOUT"] = str(self.timeout)
        attempts = [not is_custom, False] if not is_custom else [False]
        last_err = ""
        for use_constraints in attempts:
            cmd = self._build_install_cmd(missing, use_constraints=use_constraints)
            _LOGGER.info("Installing HA flow requirements for %s: %s", domain, missing)
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                env=env,
                timeout=self.timeout,
                check=False,
            )
            if proc.returncode == 0:
                self.ensure_sys_path()
                # Refresh importlib.metadata working set for newly populated --target.
                importlib.metadata.distributions(path=sys.path)
                for req in missing:
                    self._installed_cache.add(req)
                return
            last_err = (proc.stderr or proc.stdout or f"exit code {proc.returncode}").strip()
        raise MissingRequirementsError(
            domain,
            missing,
            f"Failed installing Python requirements for {domain} ({', '.join(missing)}): {last_err}",
        )

    async def ensure_requirements_list(
        self,
        domain: str,
        requirements: Iterable[str],
        *,
        is_custom: bool = False,
    ) -> None:
        """Install any missing packages from requirements list into deps_dir."""
        reqs = [req for req in requirements if req]
        if not reqs:
            return
        async with self._lock:
            missing = [req for req in reqs if not self.is_requirement_satisfied(req)]
            if not missing:
                return
            if not self.auto_install:
                raise MissingRequirementsError(domain, missing)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._install_sync, domain, missing, is_custom)

    async def ensure_domain(
        self,
        hass: HomeAssistant,
        domain: str,
        visited: set[str] | None = None,
    ) -> None:
        """Recursively verify dependencies & requirements for an integration domain."""
        if visited is None:
            visited = set()
        if domain in visited or domain in self._verified_domains:
            return
        visited.add(domain)

        integration = await loader.async_get_integration(hass, domain)
        for dep in integration.dependencies:
            try:
                await self.ensure_domain(hass, dep, visited)
            except loader.IntegrationNotFound:
                _LOGGER.debug("Ignoring unknown dependency %s of %s", dep, domain)

        if integration.requirements:
            await self.ensure_requirements_list(
                domain,
                integration.requirements,
                is_custom=not integration.is_built_in,
            )

        self._verified_domains.add(domain)

    def patch_homeassistant(self, hass: HomeAssistant) -> None:
        """Route HA's internal RequirementsManager installs through this installer."""
        installer = self

        class _HausRequirementsManager(ha_requirements.RequirementsManager):
            async def async_process_requirements(
                self, name: str, requirements: list[str]
            ) -> None:
                try:
                    integ = await loader.async_get_integration(self.hass, name)
                    is_custom = not integ.is_built_in
                except loader.IntegrationNotFound:
                    is_custom = True
                await installer.ensure_requirements_list(
                    name, requirements, is_custom=is_custom
                )

        hass.data[ha_requirements.DATA_REQUIREMENTS_MANAGER] = _HausRequirementsManager(
            hass
        )
