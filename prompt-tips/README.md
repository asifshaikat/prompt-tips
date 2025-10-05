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
- GET `/api/tips?sort=hot|new|top&window=24h|7d|all&cursor=&limit=20`
- GET `/api/tips/:id`
- POST `/api/tips/:id/vote` `{ "vote": 1|0|-1, "userToken": "u_..." }`

## Ops
- Rebuild global view every minute (cron) or micro-batch in app.
- Use `nginx.example.conf` for microcaching with `stale-while-revalidate`.

## Deploy
- Run `npm run rebuild` during deploy, then start the server.

---
## CI/CD (GitHub Actions)
- Set repo secrets: `SSH_PRIVATE_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`
- On push to `main`, the workflow `.github/workflows/deploy.yml` runs:
  - SSH to server → `git reset --hard origin/main` → `npm ci` → `npm run rebuild` → restart service → reload nginx.
