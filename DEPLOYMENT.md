# Deployment Guide

Production stack used by this project:

- App server: Render (long-lived WebSocket support)
- PostgreSQL: Supabase
- Redis: Upstash Redis
- Optional frontend hosting: Vercel

## 1. Provision Database (Supabase)

1. Create a Supabase project.
2. Open SQL Editor.
3. Run [`sql/schema.sql`](./sql/schema.sql).
4. Copy the Postgres connection URL (SSL required).

Example:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:6543/postgres?sslmode=require
```

## 2. Provision Redis (Upstash)

1. Create an Upstash Redis database.
2. Copy the TLS URL.

Example:

```env
REDIS_URL=rediss://default:PASSWORD@HOST:PORT
```

## 3. Deploy Backend on Render

1. Push this repo to GitHub.
2. In Render, create a Web Service (Blueprint supported via `render.yaml`).
3. Set the following environment variables:

```env
NODE_ENV=production
APP_BASE_URL=https://YOUR-BACKEND.onrender.com
CLIENT_ORIGIN=https://YOUR-FRONTEND-DOMAIN

DATABASE_URL=postgres://...
REDIS_URL=rediss://...

AUTH_TOKEN_SECRET=long-random-secret
REFRESH_TOKEN_SECRET=second-long-random-secret
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

PRESENCE_TTL_SECONDS=45
TYPING_TTL_SECONDS=5
HEARTBEAT_INTERVAL_MS=30000
MESSAGE_HISTORY_PAGE_SIZE=50
MAX_MESSAGE_LENGTH=2000

HTTP_LOGIN_LIMIT_PER_SECOND=5
HTTP_SEARCH_LIMIT_PER_SECOND=5
WS_MESSAGE_LIMIT_PER_SECOND=10
WS_EVENT_LIMIT_PER_SECOND=30
```

4. Deploy and confirm health endpoint:

```text
GET https://YOUR-BACKEND.onrender.com/health
```

## 4. API and WebSocket Contract (Production)

HTTP:

- `POST /register`
- `POST /login`
- `POST /refresh`
- `GET /users/search?q=<text>` (Bearer token)
- `POST /conversations/direct` (Bearer token)
- `GET /conversations/:conversationId/messages?limit=50&before=<ISO timestamp>` (Bearer token)

WebSocket:

```text
wss://YOUR-BACKEND.onrender.com/ws?token=<access_token>
```

Important behavior:

- Access token required at handshake.
- Expired/invalid JWT is rejected.
- Server closes socket on token expiry; client should refresh and reconnect.
- Room-scoped broadcast (`cid` per conversation).
- Redis Pub/Sub fan-out enabled across instances.

## 5. Optional Frontend on Vercel

If hosting UI separately:

1. Deploy frontend to Vercel.
2. Set frontend API base URL to Render backend.
3. Set `CLIENT_ORIGIN` on backend to the Vercel domain.
4. Use `wss://YOUR-BACKEND.../ws` from frontend and send the first message:

```json
{ "type": "auth", "jwt": "YOUR_ACCESS_TOKEN" }
```

## 6. Post-Deploy Smoke Test

1. Register two users (`/register`).
2. Login both (`/login`) and capture access/refresh tokens.
3. Create/open a direct conversation (`/conversations/direct`).
4. Connect two WebSocket clients with both access tokens.
5. Join the same room via `{ "type":"join", "cid":"..." }`.
6. Send message with client UUID:

```json
{ "type":"message", "cid":"<conversation_uuid>", "clid":"<uuid>", "msg":"hello" }
```

7. Verify:
- `ack` received by sender.
- `message` event received by peer.
- Re-sending same `clid` does not duplicate persisted message.

## 7. Production Hardening Checklist

- Rotate JWT secrets regularly.
- Add edge-level WAF/rate-limits in front of app-level limits.
- Enable centralized logs and alerting.
- Restrict CORS/Origin to known frontend domains only.
- Back up database and test restore process.
