#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "Bu klasor Git deposu degil. Once VDS-KURULUM.md adimlarini uygulayin."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo ".env dosyasi bulunamadi. Token bilgilerini GitHub'a koymadan VDS uzerinde .env olusturun."
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "V4" ]]; then
  echo "Bu script V4 branch'i icin hazirlandi. Mevcut branch: $BRANCH"
  exit 1
fi

OLD_COMMIT="$(git rev-parse HEAD)"
git pull --ff-only origin V4
NEW_COMMIT="$(git rev-parse HEAD)"

if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
elif [[ "$OLD_COMMIT" != "$NEW_COMMIT" ]] && git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" | grep -Eq '^(package\.json|package-lock\.json)$'; then
  npm ci --no-audit --no-fund
fi

if pm2 describe logbot >/dev/null 2>&1; then
  pm2 reload logbot --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save
echo "V4 guncellendi ve logbot PM2 ile calisiyor."
