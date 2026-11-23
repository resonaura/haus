# SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov.
"""On-demand dependency resolver for Home Assistant integration flows."""

from __future__ import annotations

import asyncio
import importlib
import importlib.metadata
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

from homeassistant import loader
from homeassistant import requirements as ha_requirements
from homeassistant.core import HomeAssistant
from homeassistant.util import package as pkg_util

_LOGGER = logging.getLogger(__name__)

# Shimmed HA OS / UI / DB / Cloud system components whose requirements are never executed in Haus.
_SKIP_SHIMMED_REQUIREMENT_DOMAINS = frozenset({"frontend", "recorder", "cloud", "hassio", "camera"})


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
        """Append deps_dir after base venv site-packages so core HA deps are never shadowed."""
        deps_str = str(self.deps_dir)
        if deps_str in sys.path:
            # Ensure base site-packages stay ahead of deps_dir even if externally injected.
            if sys.path[0] == deps_str:
                sys.path.remove(deps_str)
                sys.path.append(deps_str)
        else:
            sys.path.append(deps_str)
        importlib.invalidate_caches()

    def _write_merged_constraints(self) -> Path | None:
        """Merge HA package_constraints.txt with exact base-venv pins to prevent version drift."""
        constraints_path = Path(ha_requirements.__file__).with_name(
            ha_requirements.CONSTRAINT_FILE
        )
        deps_prefix = str(self.deps_dir)
        lines: list[str] = []
        pinned: set[str] = set()
        base_paths = [p for p in sys.path if p and str(Path(p).resolve()) != deps_prefix]
        for dist in importlib.metadata.distributions(path=base_paths):
            name = (dist.metadata.get("Name") or "").strip()
            ver = (dist.version or "").strip()
            if not name or not ver:
                continue
            norm = name.lower().replace("_", "-")
            if norm in pinned:
                continue
            pinned.add(norm)
            lines.append(f"{name}=={ver}\n")
        if constraints_path.is_file():
            for raw in constraints_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                stripped = raw.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                pkg_key = re.split(r"[=<>!~;\[\s]", stripped, maxsplit=1)[0].strip().lower().replace("_", "-")
                if pkg_key not in pinned:
                    lines.append(stripped + "\n")
        if not lines:
            return None
        with tempfile.NamedTemporaryFile("w", suffix="-constraints.txt", delete=False) as fh:
            fh.writelines(lines)
            return Path(fh.name)

    def is_requirement_satisfied(self, requirement_str: str) -> bool:
        """Check whether requirement_str is currently importable in sys.path."""
        if requirement_str in self._installed_cache:
            return True
        self.ensure_sys_path()
        if pkg_util.is_installed(requirement_str):
            self._installed_cache.add(requirement_str)
            return True
        return False

    def _has_uv(self) -> bool:
        return importlib.util.find_spec("uv") is not None or bool(self.uv_bin)

    def _build_install_cmd(
        self,
        specs: list[str],
        *,
        use_constraints: bool,
        constraints_file: Path | None = None,
        override_file: Path | None = None,
        only_binary: bool = False,
    ) -> list[str]:
        constraints_path = constraints_file or Path(ha_requirements.__file__).with_name(
            ha_requirements.CONSTRAINT_FILE
        )
        constraint_args = (
            ["--constraint", str(constraints_path)]
            if use_constraints and constraints_path.is_file()
            else []
        )
        override_args = ["--override", str(override_file)] if override_file else []
        binary_args = ["--only-binary", ":all:"] if only_binary else []
        has_uv_mod = importlib.util.find_spec("uv") is not None
        if has_uv_mod:
            return [
                sys.executable,
                "-m",
                "uv",
                "pip",
                "install",
                "--quiet",
                "--link-mode=copy",
                "--index-strategy",
                "unsafe-first-match",
                *binary_args,
                "--target",
                str(self.deps_dir),
                *constraint_args,
                *override_args,
                *specs,
            ]
        if self.uv_bin:
            return [
                self.uv_bin,
                "pip",
                "install",
                "--quiet",
                "--link-mode=copy",
                "--python",
                sys.executable,
                "--index-strategy",
                "unsafe-first-match",
                *binary_args,
                "--target",
                str(self.deps_dir),
                *constraint_args,
                *override_args,
                *specs,
            ]
        return [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--quiet",
            "--disable-pip-version-check",
            *binary_args,
            "--target",
            str(self.deps_dir),
            *constraint_args,
            *specs,
        ]

    def _mark_installed(self, missing: list[str]) -> None:
        self.ensure_sys_path()
        # Refresh importlib.metadata working set for newly populated --target.
        importlib.metadata.distributions(path=sys.path)
        for req in missing:
            self._installed_cache.add(req)

    def _install_sync(self, domain: str, missing: list[str], is_custom: bool) -> None:
        env = os.environ.copy()
        env["HTTP_TIMEOUT"] = str(self.timeout)
        merged_constraints = self._write_merged_constraints()
        # Try constrained against live venv + HA pins first (even for custom components) to avoid
        # pulling mismatched transitive copies of aiohttp/cryptography/anyio into deps_dir.
        attempts = [True, False] if merged_constraints else ([not is_custom, False] if not is_custom else [False])
        last_err = ""
        try:
            for use_constraints in attempts:
                cmd = self._build_install_cmd(
                    missing,
                    use_constraints=use_constraints,
                    constraints_file=merged_constraints if use_constraints else None,
                )
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
                    self._mark_installed(missing)
                    return
                last_err = (proc.stderr or proc.stdout or f"exit code {proc.returncode}").strip()
        finally:
            if merged_constraints is not None:
                merged_constraints.unlink(missing_ok=True)

        err_lower = last_err.lower()
        is_build_err = (
            "failed to build" in err_lower
            or "no such file or directory: 'cc'" in err_lower
            or "could not build wheels" in err_lower
        )
        if self._has_uv() and "netifaces" in err_lower and is_build_err:
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as ov:
                ov.write('netifaces; python_version < "0"\n')
                ov_path = Path(ov.name)
            try:
                compat_specs = [
                    spec for spec in missing if not spec.strip().lower().startswith("netifaces")
                ]
                compat_specs.append("netifaces-plus>=0.12.5")
                cmd = self._build_install_cmd(
                    compat_specs, use_constraints=False, override_file=ov_path
                )
                _LOGGER.info(
                    "Retrying HA flow requirements for %s with netifaces-plus wheel override: %s",
                    domain,
                    compat_specs,
                )
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=self.timeout,
                    check=False,
                )
                if proc.returncode == 0:
                    self._mark_installed(missing)
                    return
                last_err = (proc.stderr or proc.stdout or f"exit code {proc.returncode}").strip()
            finally:
                ov_path.unlink(missing_ok=True)

        if is_build_err:
            cmd = self._build_install_cmd(missing, use_constraints=False, only_binary=True)
            _LOGGER.info("Retrying HA flow requirements for %s with --only-binary :all:", domain)
            proc = subprocess.run(
                cmd, capture_output=True, text=True, env=env, timeout=self.timeout, check=False
            )
            if proc.returncode == 0:
                self._mark_installed(missing)
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
        if domain in _SKIP_SHIMMED_REQUIREMENT_DOMAINS:
            self._verified_domains.add(domain)
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
            # HA 2024 passes (name, requirements); HA 2026+ passes is_built_in too.
            async def async_process_requirements(
                self,
                name: str,
                requirements: list[str],
                is_built_in: bool | None = None,
            ) -> None:
                if is_built_in is None:
                    try:
                        integ = await loader.async_get_integration(self.hass, name)
                        is_custom = not integ.is_built_in
                    except loader.IntegrationNotFound:
                        is_custom = True
                else:
                    is_custom = not is_built_in
                await installer.ensure_requirements_list(
                    name, requirements, is_custom=is_custom
                )

            # Treat optional after/discovery dependencies as best-effort so optional
            # toolchain failures (e.g. assist_pipeline/esphome via bluetooth_adapters)
            # do not abort unrelated config flows like xiaomi_ble.
            async def _async_process_integration(
                self,
                integration: loader.Integration,
                done: set[str],
            ) -> None:
                if integration.domain in _SKIP_SHIMMED_REQUIREMENT_DOMAINS:
                    return
                if integration.requirements:
                    await self.async_process_requirements(
                        integration.domain,
                        integration.requirements,
                        integration.is_built_in,
                    )

                cache = self.integrations_with_reqs

                def _is_pending(dep: str) -> bool:
                    if dep in done:
                        return False
                    cached = cache.get(dep)
                    return cached is None or type(cached) is not loader.Integration

                required_deps = {
                    dep for dep in integration.dependencies if _is_pending(dep)
                }
                discovery_integrations = getattr(
                    ha_requirements, "DISCOVERY_INTEGRATIONS", {}
                )
                discovery_deps = {
                    check_domain
                    for check_domain, to_check in discovery_integrations.items()
                    if any(check in integration.manifest for check in to_check)
                }
                after_deps = getattr(integration, "after_dependencies", ()) or ()
                optional_deps = {
                    dep
                    for dep in (set(after_deps) | discovery_deps)
                    if dep not in required_deps and _is_pending(dep)
                }

                exceptions: list[Exception] = []
                for dep in required_deps:
                    try:
                        await self.async_get_integration_with_requirements(dep, done)
                    except Exception as ex:
                        exceptions.insert(0, ex)
                if exceptions:
                    raise exceptions[0]

                for dep in optional_deps:
                    try:
                        await self.async_get_integration_with_requirements(dep, done)
                    except Exception as ex:
                        _LOGGER.debug(
                            "Ignoring optional after/discovery dependency %s for %s: %s",
                            dep,
                            integration.domain,
                            ex,
                        )

        hass.data[ha_requirements.DATA_REQUIREMENTS_MANAGER] = _HausRequirementsManager(
            hass
        )
