# Prompt Tips (no-DB, no-Redis)

Filesystem-backed tips feed with votes, ETag/SWR caching, and double-buffered global view.

## Quick start
```bash
cp .env.example .env
npm install
npm run seed            # writes per-tip files from seeds/tips.seed.yaml
npm run rebuild         # builds double-buffered global view + pointer
npm run dev             # http://localhost:3000
```

## Endpoints
- GET `/api/tips?sort=hot|new|top&window=24h|7d|30d|all&cursor=&limit=20`
- GET `/api/tips/:id`
- POST `/api/tips/:id/vote` `{ "vote": 1|0|-1, "userToken": "u_..." }`
- POST `/api/username` `{ "userToken": "u_...", "username": "YourName" }` (global, case-insensitive uniqueness)

## Markdown & Security
- Server-side Markdown via **marked** + sanitized with **DOMPurify + JSDOM** → API returns `content_html`.
- Clients should render `content_html` (already sanitized).

## Usernames
- `/api/username` enforces **global, case-insensitive uniqueness** (3–20 chars, `[a-z0-9_-]`).

## Deploy
- Run `npm run rebuild` during deploy, then start the server.
