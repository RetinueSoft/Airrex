# Deploying AirRex with Docker

Two containers: `airrex-app` (Node: API + built web app) and `airrex-postgres` (PostgreSQL 18). The server is set up
by **RetinueSoft/VpsSetup** (`/root/common`): the common Caddy serves it on **https://airrex.retinuesoft.com** and
`https://<server-ip>:8087` (`caddy/sites/airrex.caddy`), one GitHub token, the shared `POSTGRES_PASSWORD`, nightly backups to Azure, and the
settings file `/root/common/env/airrex.env`. This repo holds the app and its `deploy/update.sh`.

**How updates flow:** merge a `feature/...` branch into `release` → GitHub Actions builds
`ghcr.io/retinuesoft/airrex` (tags `latest` and `sha-<commit>`) → on the server, `sudo /root/airrex/update.sh`
pulls it and restarts the app. The server never builds code.

## Install (once)

`/root/common/setup.sh` installs every app listed in VpsSetup's `apps.conf`, AirRex included: it creates
`/root/airrex`, downloads `update.sh` and runs it.

```
/root/airrex/
├── update.sh            keeps itself up to date from the release branch
├── docker-compose.yml   downloaded by update.sh
├── .env.example         downloaded by update.sh (template)
└── .deployed_sha        commit of the running image
```

Then fill in the API keys in `/root/common/env/airrex.env` (below) and run `sudo /root/airrex/update.sh` again.

## The database

PostgreSQL database `airrex` on the Docker volume `airrex_postgres-data`, so it survives image updates. The app
creates and updates its tables itself on startup. For pgAdmin/DBeaver, use an SSH tunnel to `127.0.0.1:5436`.

## Day-to-day

| Task | Command |
|---|---|
| Update to the newest version | `sudo /root/airrex/update.sh` |
| Back up first, then update | `sudo /root/airrex/update.sh --backup` |
| Roll back to an earlier build | `sudo /root/airrex/update.sh sha-1a2b3c4` (tags: GitHub → Packages → airrex) |
| Logs | `app-compose airrex logs -f app` |
| Back up now | `sudo /root/common/backup-db.sh airrex` |
| Restore a backup | `sudo /root/common/restore-db.sh airrex <file>` (replaces the database) |
| Admin tasks | `app-compose airrex exec app node server/admin.ts` |

## Settings (`/root/common/env/airrex.env`)

| Variable | What it is |
|---|---|
| `SERPAPI_API_KEY` | live Google Flights prices; empty = demo fares |
| `TRAVELPAYOUTS_TOKEN` | "Cheapest dates" calendar |
| `PASSENGER_DATA_KEY` | encrypts saved passengers; back it up separately from the database |
| `APP_HOST_PORT` | port on 127.0.0.1 (default `18087`); must match `caddy/sites/airrex.caddy` in VpsSetup |
| `POSTGRES_HOST_PORT` | database port on 127.0.0.1 (default `5436`) |
| `TZ` | server time zone for log timestamps |
| `APP_IMAGE_TAG` | image tag in use; set by `update.sh` |

`POSTGRES_PASSWORD` comes from the shared `/root/common/.env`.

### Build-time settings

`VITE_*` settings and `AIRREX_SITE_URL` are built into the image, so changing them in `airrex.env` does nothing.
Set them as GitHub repository variables (Settings → Secrets and variables → Actions → Variables) and re-run the
**Docker image** workflow. `AIRREX_SITE_URL` defaults to `https://airrex.retinuesoft.com` (the address the AirRex
Helper extension recognises); set the variable only if the site moves.
