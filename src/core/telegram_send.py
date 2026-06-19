"""Send Telegram messages via Bot API (notifications, broadcasts)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)


def _bot_token() -> str:
    return os.getenv("telegram_bot_token", "").strip()


def send_message(
    telegram_id: int,
    text: str,
    *,
    parse_mode: str | None = "HTML",
    disable_web_page_preview: bool = True,
) -> bool:
    token = _bot_token()
    if not token:
        logger.warning("telegram_bot_token not set — cannot send message")
        return False
    body: dict[str, object] = {
        "chat_id": telegram_id,
        "text": text[:4096],
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        body["parse_mode"] = parse_mode
    data = urllib.parse.urlencode(body).encode("utf-8")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not payload.get("ok"):
            logger.warning("Telegram sendMessage failed for %s: %s", telegram_id, payload)
            return False
        return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        logger.warning("Telegram HTTP %s for %s: %s", exc.code, telegram_id, detail)
        return False
    except urllib.error.URLError as exc:
        logger.warning("Telegram network error for %s: %s", telegram_id, exc)
        return False
