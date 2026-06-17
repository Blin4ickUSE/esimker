"""Telegram bot: /start with localized welcome and mini-app launch button."""

from __future__ import annotations

import html
import logging
import os
import sys
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from core.database import Database  # noqa: E402
from core.security import SecurityError, validate_referral_code  # noqa: E402

I18N_DIR = ROOT / "assets" / "i18n"

WELCOME_EMOJI_ID = "5931472654660800739"
BUTTON_EMOJI_ID = "5879585266426973039"

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


class BotState:
    def __init__(self) -> None:
        self.db = Database()
        self.db.init()


STATE = BotState()


def parse_i18n(path: Path) -> dict[str, str]:
    strings: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        eq = trimmed.find("=")
        if eq == -1:
            continue
        key = trimmed[:eq].strip()
        value = trimmed[eq + 1 :].strip()
        if key:
            strings[key] = value
    return strings


TABLES: dict[str, dict[str, str]] = {
    "ru": parse_i18n(I18N_DIR / "ru.txt"),
    "en": parse_i18n(I18N_DIR / "en.txt"),
}


def resolve_lang(language_code: str | None) -> str:
    if language_code and language_code.lower().startswith("ru"):
        return "ru"
    return "en"


def t(lang: str, key: str, **kwargs: str) -> str:
    table = TABLES.get(lang, TABLES["en"])
    template = table.get(key, TABLES["en"].get(key, key))
    return template.format(**kwargs) if kwargs else template


def miniapp_base_url() -> str:
    return os.getenv("MINIAPP_URL", "https://localhost:5173").strip().rstrip("/")


def miniapp_open_url(ref: str | None = None) -> str:
    base = miniapp_base_url()
    if ref:
        return f"{base}/?ref={quote(ref)}"
    return f"{base}/"


def parse_start_payload(args: list[str]) -> str | None:
    if not args:
        return None
    raw = args[0].strip()
    if raw.lower().startswith("ref_"):
        raw = raw[4:]
    if not raw:
        return None
    try:
        return validate_referral_code(raw)
    except SecurityError:
        logger.warning("Ignoring invalid /start payload: %s", args[0])
        return None


def build_start_text(lang: str, name: str) -> str:
    welcome = html.escape(t(lang, "bot.startWelcome", name=name))
    body = t(lang, "bot.startBody")
    return (
        f'<tg-emoji emoji-id="{WELCOME_EMOJI_ID}">📊</tg-emoji> '
        f"<b>{welcome}</b>\n\n"
        f"{body}"
    )


def build_inline_keyboard(lang: str, web_app_url: str) -> InlineKeyboardMarkup:
    button = InlineKeyboardButton(
        text=t(lang, "bot.launchMiniApp"),
        web_app=WebAppInfo(url=web_app_url),
        api_kwargs={
            "icon_custom_emoji_id": BUTTON_EMOJI_ID,
            "style": "primary",
        },
    )
    return InlineKeyboardMarkup([[button]])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return

    lang = resolve_lang(user.language_code)
    name = user.first_name or ("друг" if lang == "ru" else "friend")
    ref = parse_start_payload(list(context.args or []))

    try:
        STATE.db.touch_user(
            user.id,
            username=user.username,
            first_name=user.first_name,
            last_name=user.last_name,
            language_code=user.language_code,
            referral_code_from_link=ref,
        )
    except SecurityError as exc:
        logger.warning("Could not register user %s: %s", user.id, exc)

    text = build_start_text(lang, name)
    web_app_url = miniapp_open_url(ref)

    await update.message.reply_text(
        text,
        parse_mode=ParseMode.HTML,
        reply_markup=build_inline_keyboard(lang, web_app_url),
    )


def main() -> None:
    load_dotenv(ROOT / ".env")
    token = os.getenv("telegram_bot_token", "").strip()
    if not token:
        raise SystemExit("telegram_bot_token is not set in .env")

    miniapp_url = miniapp_base_url()
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    logger.info("Bot started (miniapp: %s)", miniapp_url)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
