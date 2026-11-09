"""What released Hermes (0.19) lacks of the gateway's plugin API: its helpers, and fields newer
registries take."""

import dataclasses
import os
from typing import Any, Callable, Optional


def get_scoped_secret(name: str, default: Any = None, **_: Any) -> Any:
    value = os.getenv(name)
    return value if value is not None else default


def extra_or_secret(extra: Optional[dict], key: str, env: str, default: Any = "", **_: Any) -> Any:
    value = get_scoped_secret(env, None) if env else None
    if value is not None and str(value).strip():
        return value
    value = (extra or {}).get(key)
    return default if value is None or (isinstance(value, str) and not value.strip()) else value


def seed_extra_from_env(spec, *, home_env: Optional[str] = None, home_default: str = "") -> dict:
    seed = {}
    for env, key, conv in spec:
        raw = str(get_scoped_secret(env, "") or "").strip()
        if raw:
            seed[key] = conv(raw) if conv else raw
    home = home_env and (str(get_scoped_secret(home_env, "") or "").strip() or home_default)
    if home:
        seed["home_channel"] = {"chat_id": home, "name": get_scoped_secret(f"{home_env}_NAME", "Home")}
    return seed


def env_is_connected(*names: str) -> Callable[[Any], bool]:
    return lambda _config: all(str(get_scoped_secret(n, "") or "").strip() for n in names)


def send_error(message: Any) -> dict:
    try:
        from tools.send_message_senders import _error

        return _error(str(message))
    except ImportError:
        return {"error": str(message)}


def register_platform(ctx, **fields: Any) -> None:
    """Registers with the fields this Hermes knows."""
    from gateway.platform_registry import PlatformEntry

    known = {f.name for f in dataclasses.fields(PlatformEntry)}
    ctx.register_platform(**{k: v for k, v in fields.items() if k in known})
