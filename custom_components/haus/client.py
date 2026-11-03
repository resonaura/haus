"""Camera-only Haus client. SPDX-License-Identifier: GPL-3.0-or-later."""

import ipaddress
import re
from urllib.parse import urlsplit
from uuid import uuid4

import aiohttp


class HausAuthError(Exception):
    """The camera capability was revoked or enrollment expired."""


class HausConnectionError(Exception):
    """Haus is unavailable or returned an invalid camera response."""


def normalize_url(value: str) -> str:
    """Accept an explicit local Helper base URL without credentials."""
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("Invalid Haus URL")
    try:
        local = ipaddress.ip_address(parsed.hostname).is_private
    except ValueError:
        local = parsed.hostname == "localhost" or parsed.hostname.endswith(
            (".local", ".lan", ".home.arpa")
        )
    if parsed.scheme == "http" and not local:
        raise ValueError("Plain HTTP is restricted to the local network")
    return f"{parsed.scheme}://{parsed.netloc}"


class HausClient:
    """No HA credential, RTSP source or node key is sent through this client."""

    def __init__(
        self, session: aiohttp.ClientSession, url: str, token: str = ""
    ) -> None:
        self.session = session
        self.url = normalize_url(url)
        self.token = token

    async def request(
        self, method: str, path: str, data: dict | None = None, image: bool = False
    ):
        """Bound every response, including camera images and signaling."""
        headers = {"X-Haus-Client": "1"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with self.session.request(
                method,
                f"{self.url}{path}",
                json=data,
                headers=headers,
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=25),
            ) as response:
                if response.status == 401:
                    raise HausAuthError
                if response.status != 200:
                    raise HausConnectionError
                limit = 6 * 1024 * 1024 if image else 1024 * 1024
                chunks = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    chunks.extend(chunk)
                    if len(chunks) > limit:
                        raise HausConnectionError
                if image:
                    if not chunks.startswith(b"\xff\xd8"):
                        raise HausConnectionError
                    return bytes(chunks)
                import json

                result = json.loads(chunks)
                if not isinstance(result, dict):
                    raise HausConnectionError
                return result
        except HausAuthError:
            raise
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise HausConnectionError from err

    async def enroll(self, code: str) -> dict:
        result = await self.request("POST", "/ha/enroll", {"code": code.strip()})
        if result.get("profile") != 1 or not re.fullmatch(
            r"[a-f0-9]{64}", result.get("token", "")
        ):
            raise HausAuthError
        return result

    async def cameras(self) -> dict:
        result = await self.request("GET", "/ha/cameras")
        if (
            result.get("profile") != 1
            or not isinstance(result.get("cameras"), list)
            or len(result["cameras"]) > 256
        ):
            raise HausConnectionError
        return {
            item["id"]: item
            for item in result["cameras"]
            if isinstance(item, dict)
            and re.fullmatch(r"camera\.[a-z0-9_]+", item.get("id", ""))
        }

    async def devices(self) -> list:
        result = await self.request("GET", "/ha/native/devices")
        devices = result.get("devices")
        if not isinstance(devices, list) or len(devices) > 256:
            raise HausConnectionError
        return devices

    async def command(self, camera_id: str, entity_id: str, command: dict):
        if not re.fullmatch(r"camera\.[a-z0-9_]+", camera_id) or not re.fullmatch(
            r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}", entity_id
        ):
            raise ValueError("Invalid native camera control")
        return await self.request(
            "POST",
            f"/ha/native/{camera_id}/{entity_id}/command",
            {
                "requestId": str(uuid4()),
                "command": command,
            },
        )

    async def camera(self, camera_id: str, action: str, data: dict | None = None):
        if not re.fullmatch(r"camera\.[a-z0-9_]+", camera_id) or action not in (
            "snapshot",
            "viewer",
            "candidate",
            "lease",
            "close",
        ):
            raise ValueError("Invalid camera operation")
        return await self.request(
            "GET" if action == "snapshot" else "POST",
            f"/ha/cameras/{camera_id}/{action}",
            data,
            image=action == "snapshot",
        )
