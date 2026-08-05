from __future__ import annotations

from urllib.parse import urlsplit


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def require_loopback_bind(host: str) -> None:
    if host not in {"127.0.0.1", "::1"}:
        raise ValueError("Life Hub may only bind to a loopback address")


def valid_host(value: str | None) -> bool:
    if not value:
        return False
    host = value.rsplit(":", 1)[0] if value.count(":") == 1 else value
    return host in LOOPBACK_HOSTS


def valid_origin(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
