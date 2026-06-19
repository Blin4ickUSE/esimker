# External Reseller API

Base URL: `https://<your-domain>/api/v1`

All requests must use **HTTPS**. Authentication uses HMAC-SHA256 with a per-user API secret.

## Credentials

Generate credentials in the mini-app: **Settings → API for resellers**.

| Field | Description |
|-------|-------------|
| **Client ID** | Your Telegram user ID |
| **Client Secret** | Random secret (shown once when generated) |
| **Webhook URL** | Optional HTTPS endpoint for subscription events |

Store the client secret securely. It cannot be recovered after generation — only rotated.

## Authentication

Include these headers on every request:

| Header | Description |
|--------|-------------|
| `X-Client-Id` | Your Telegram ID (client ID) |
| `X-Api-Secret` | Your client secret |
| `X-Timestamp` | Unix time (seconds), max ±60s skew |
| `X-Nonce` | Random 16–64 char string (replay-protected) |
| `X-Signature` | HMAC-SHA256 hex digest (see below) |

### Signature

```
body_hash = SHA256(request_body_bytes)   # empty body → SHA256("")
message = "{timestamp}\n{nonce}\n{METHOD}\n{path}\n{body_hash}"
signature = HMAC_SHA256_hex(client_secret, message)
```

`path` is the URL path only (e.g. `/api/v1/balance`), without query string.

### Example (balance)

```bash
TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY=""
BODY_HASH=$(echo -n "$BODY" | openssl dgst -sha256 | awk '{print $2}')
MSG="${TS}\n${NONCE}\nGET\n/api/v1/balance\n${BODY_HASH}"
SIG=$(printf '%b' "$MSG" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" | awk '{print $2}')

curl -s "https://app.example.com/api/v1/balance" \
  -H "X-Client-Id: $CLIENT_ID" \
  -H "X-Api-Secret: $CLIENT_SECRET" \
  -H "X-Timestamp: $TS" \
  -H "X-Nonce: $NONCE" \
  -H "X-Signature: $SIG"
```

Response:

```json
{ "balance": 12.50, "currency": "USD" }
```

## Endpoints

### `GET /api/v1/balance`

Returns account balance in USD.

### `GET /api/v1/esims`

List active eSIM profiles (same shape as mini-app).

### `POST /api/v1/purchase`

Purchase an eSIM from balance.

Body:

```json
{
  "country_code": "TR",
  "gb": 3,
  "days": 30
}
```

Response includes `orderId`, `esimId`, `amountUsd`, `balance`, and `esim` object.

Errors: `402` insufficient balance, `400` invalid plan, `401` auth failure.

## Outbound webhooks (subscription events)

When you set a webhook URL in settings, esimker sends POST requests when an eSIM subscription is about to expire.

Headers:

- `X-Timestamp` — Unix time
- `X-Signature` — `HMAC_SHA256_hex(webhook_secret, "{timestamp}.{body}")`

Body:

```json
{
  "event": "subscription.expiring",
  "esimId": "abc123",
  "payload": { "expiresAt": "2026-07-01T12:00:00+00:00", "name": "Turkey" }
}
```

The webhook secret is shown once when you save the webhook URL.

## Security notes

- Always use HTTPS for API and webhook endpoints.
- Rotate client secret if compromised (generate new secret in settings).
- Nonces are single-use per client ID (replay protection).
- Requests with timestamps outside ±60s are rejected.
- API access requires an active, non-blocked account.
- Never expose client secret in client-side code or public repos.

## Payment webhooks (incoming)

For your own payment integrations:

| Provider | URL |
|----------|-----|
| Platega | `https://<PLATEGA_WEBHOOK_DOMAIN>/api/webhooks/platega` |
| CryptoBot | `https://<PLATEGA_WEBHOOK_DOMAIN>/api/webhooks/cryptobot` |

Configure `cryptobot_api_token` in `.env` and set the webhook URL in @CryptoBot → Crypto Pay → My Apps.
