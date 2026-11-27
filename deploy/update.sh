#!/usr/bin/env bash
# Installs or updates AirRex on the server, from the release branch. Needs /root/common (RetinueSoft/VpsSetup);
# /root/common/setup.sh installs it the first time (every app in VpsSetup apps.conf).
#
#   sudo /root/airrex/update.sh                 newest release build
#   sudo /root/airrex/update.sh --backup        back up the database first, then update
#   sudo /root/airrex/update.sh sha-1a2b3c4     run a specific build (rollback); tags: GitHub → Packages → airrex
#
# Each run: updates this script, downloads docker-compose.yml and .env.example from release, adds new settings
# to /root/common/env/airrex.env (your values are kept), pulls the image and restarts what changed. The app
# creates/updates its database tables itself on startup. HTTPS: /root/common/caddy/sites/airrex.caddy
# (proxies to 127.0.0.1:APP_HOST_PORT).
set -euo pipefail

NAME="airrex"
REPO="RetinueSoft/Airrex"

[ -f /root/common/lib.sh ] || { echo "/root/common is missing: run VpsSetup's setup.sh first"; exit 1; }
. /root/common/lib.sh

need_root "$@"
cd "$(dirname "$(readlink -f "$0")")"
[ -d .git ] || [ -d ../.git ] && die "this is the source repository; run it on the server as /root/$NAME/update.sh"
with_lock "$NAME"
load_token
self_update "$REPO" deploy/update.sh "$@"

BACKUP=0; TAG=latest
for arg in "$@"; do
    case "$arg" in
        --backup) BACKUP=1 ;;
        -*)       die "unknown option $arg" ;;
        *)        TAG="$arg" ;;
    esac
done

# 1. Deployment files from the release branch.
fetch_files "$REPO" "$RELEASE_BRANCH" docker-compose.yml:docker-compose.yml .env.example:.env.example

# 2. Settings: /root/common/.env (shared by all apps, e.g. POSTGRES_PASSWORD) + /root/common/env/airrex.env
#    (this app). docker compose reads both (app_compose); nothing is kept in /root/airrex.
ENV_FILE="$(app_env_path "$NAME")"
link_app_env "$NAME"
sync_env .env.example "$ENV_FILE" || true     # API keys are optional: the app runs with demo fares without them
env_set "$ENV_FILE" APP_IMAGE_TAG "$TAG"      # remember the chosen build for a later "docker compose up"
load_app_env "$NAME"                          # /root/common/.env + env/airrex.env
[ -n "${POSTGRES_PASSWORD:-}" ] || die "POSTGRES_PASSWORD is empty: set it in $COMMON_DIR/.env (shared by all apps)"

# 3. Image.
log "pulling app image ($TAG)"
ghcr_login
app_compose "$NAME" pull app

# 4. Database: start PostgreSQL, optional backup.
app_compose "$NAME" up -d --wait postgres
if [ "$BACKUP" = 1 ]; then
    /root/common/backup-db.sh "$NAME" || die "backup failed; nothing was updated"
fi

# 5. Start / restart what changed (the app applies its schema changes on startup).
app_compose "$NAME" up -d --remove-orphans
docker image prune -f >/dev/null

# The commit the running image was built from (label set by GitHub Actions).
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' airrex-app > .deployed_sha 2>/dev/null || true
app_compose "$NAME" ps
log "$NAME is running $(docker inspect -f '{{.Config.Image}}' airrex-app) ($(cut -c1-7 .deployed_sha))"
