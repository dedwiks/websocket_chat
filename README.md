# WebSocket Chat Service

Deployable backend for real-time messaging with:

- raw Node.js HTTP + WebSocket handling
- Redis-backed presence and typing
- PostgreSQL message durability and history
- Docker local development
- managed-hosting-friendly deployment layout

## Local run

1. Copy `.env.example` to `.env`
2. Start everything:

```bash
docker compose up --build
```

## Recommended online hosting

- App server: Render
- PostgreSQL: Supabase
- Redis: Upstash Redis

Deployment steps are in `DEPLOYMENT.md`.

## HTTP API

- `GET /`
- `GET /health`
- `POST /register`
- `POST /login`
- `POST /refresh`
- `GET /users/search?q=`
- `POST /conversations/direct`
- `GET /conversations/:conversationId/messages?limit=50&before=<ISO timestamp>`

## WebSocket

Local:

```text
ws://localhost:8080/ws
```

Production:

```text
wss://YOUR-DOMAIN/ws
```

After opening the socket, the client must immediately send an auth event:

```json
{ "type": "auth", "jwt": "YOUR_ACCESS_TOKEN" }
```

Client events:

```json
{ "type": "join", "cid": "conversation-uuid" }
{ "type": "leave", "cid": "conversation-uuid" }
{ "type": "message", "cid": "conversation-uuid", "clid": "client-uuid", "msg": "hello" }
{ "type": "typing.start", "cid": "conversation-uuid" }
{ "type": "typing.stop", "cid": "conversation-uuid" }
{ "type": "pong" }
```

Server events:

```json
{ "type": "ready", "uid": "user-uuid" }
{ "type": "presence", "uid": "user-uuid", "st": "online", "ts": "..." }
{ "type": "typing.start", "cid": "conversation-uuid", "uid": "user-uuid" }
{ "type": "typing.stop", "cid": "conversation-uuid", "uid": "user-uuid" }
{ "type": "ack", "cid": "conversation-uuid", "clid": "client-uuid", "mid": 42, "ts": "..." }
{ "type": "message", "cid": "conversation-uuid", "uid": "user-uuid", "mid": 42, "clid": "client-uuid", "msg": "hello", "ts": "..." }
```
