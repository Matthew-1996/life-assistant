from __future__ import annotations

from urllib.parse import urlsplit


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def require_loopback_bind(host: str) -> None:
    if host not in {"127.0.0.1", "::1"}:
        raise ValueError("Life Hub may only bind to a loopback address")


def _authority(value: str) -> tuple[str | None, int | None]:
    try:
        parsed = urlsplit(f"//{value}")
        return parsed.hostname, parsed.port
    except ValueError:
        return None, None


def valid_host(value: str | None, *, port: int) -> bool:
    if not value:
        return False
    host, supplied_port = _authority(value)
    return host in LOOPBACK_HOSTS and supplied_port == port


def valid_origin(value: str | None, *, port: int) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "http"
        and parsed.hostname in LOOPBACK_HOSTS
        and parsed.port == port
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )
