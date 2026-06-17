# esimker

Telegram mini app для продажи eSIM: каталог тарифов, баланс, оплата, реферальная программа.

## Стек

- **Frontend** — React 18, TypeScript, Vite
- **Backend** — Python 3.12, SQLite
- **Bot** — python-telegram-bot
- **Deploy** — Docker Compose, nginx, Let's Encrypt

## Быстрый старт (production)

Требования: Linux-сервер, Docker, Docker Compose, домен с DNS на сервер.

```bash
curl -sSL https://raw.githubusercontent.com/Blin4ickUSE/esimker/main/install.sh | sudo bash
```

Или вручную:

```bash
git clone https://github.com/Blin4ickUSE/esimker.git
cd esimker
chmod +x install.sh
sudo ./install.sh
```

По умолчанию one-liner клонирует репозиторий в `/opt/esimker` (переопределение: `ESIMKER_INSTALL_DIR=/path`).

Скрипт запросит токен бота, домен и email для SSL, создаст `.env`, настроит nginx и certbot, поднимет контейнеры.

## Ручной деплой

```bash
cp .env.example .env
# заполните telegram_bot_token, MINIAPP_URL, DOMAIN и др.

docker compose up -d --build
```

Веб-приложение доступно на порту `HTTP_PORT` (по умолчанию `8080`). В production перед ним стоит host nginx с HTTPS (см. `deploy/nginx/host/esimker.conf`).

## Локальная разработка

### Backend и bot

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# ENVIRONMENT=development
# ALLOW_MOCK_PAYMENTS=true
# MINIAPP_URL=http://localhost:5173
# API_CORS_ORIGINS=http://localhost:5173

python -m src.api.webhook
python -m src.bot.bot
```

### Frontend

```bash
cd src/miniapp
npm ci
npm run dev
```

Авторизация в mini app — только через Telegram WebApp (`initData`) или Login Widget. Локально без HTTPS виджет не работает; используйте бота в Telegram или WebApp внутри Telegram.

## Переменные окружения

| Переменная | Описание |
|---|---|
| `telegram_bot_token` | Токен бота от [@BotFather](https://t.me/BotFather) |
| `telegram_bot_username` | Username бота без `@` |
| `MINIAPP_URL` | Публичный HTTPS-URL mini app |
| `DOMAIN` | Домен для nginx и SSL |
| `ENVIRONMENT` | `production` или `development` |
| `DB_PATH` | Путь к SQLite (по умолчанию `data/data.db`) |
| `dent_client_id` / `dent_client_secret` | DENT Giga Store API (опционально) |

Полный список — в [`.env.example`](.env.example).

## Структура

```
esimker/
├── assets/          # каталог тарифов, i18n, изображения оплаты
├── data/            # SQLite (создаётся при первом запуске)
├── deploy/          # Dockerfiles, nginx
├── src/
│   ├── api/         # HTTP API
│   ├── bot/         # Telegram bot
│   ├── core/        # БД, безопасность, каталог
│   └── miniapp/     # React-приложение
├── docker-compose.yml
└── install.sh
```

## Безопасность

- Не коммитьте `.env` — в нём секреты.
- В production отключены dev-обходы авторизации и mock-платежи.
- Login Widget требует HTTPS-домен, прописанный в BotFather.

## Лицензия

Проприетарный проект. Уточните условия использования у владельца репозитория.
