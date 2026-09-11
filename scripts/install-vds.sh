#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/logbot"
SERVICE_USER="logbot"
BRANCH="V4"
REPO_URL="https://github.com/hamzasar00/logbot.git"
NODE_MAJOR="22"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu script root olarak çalıştırılmalı: sudo bash install-vds.sh"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd bulunamadı. Ubuntu 24.04 gibi systemd kullanan bir VDS seç."
  exit 1
fi

echo "== Logbot V4 VDS kurulumu =="
echo "Token chat'e gönderilmez; aşağıdaki bilgiler yalnızca bu VDS üzerinde alınır."
read -r -s -p "Discord bot tokenı: " DISCORD_TOKEN
echo
read -r -p "Discord CLIENT_ID: " CLIENT_ID
read -r -p "Test sunucusu GUILD_ID: " GUILD_ID

if [[ -z "$DISCORD_TOKEN" || -z "$CLIENT_ID" || -z "$GUILD_ID" ]]; then
  echo "Token, CLIENT_ID ve GUILD_ID boş bırakılamaz."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git ufw fail2ban

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

mkdir -p "$APP_DIR/data"
umask 077
printf 'DISCORD_TOKEN=%s\nCLIENT_ID=%s\nGUILD_ID=%s\n' "$DISCORD_TOKEN" "$CLIENT_ID" "$GUILD_ID" > "$APP_DIR/.env"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

sudo -u "$SERVICE_USER" -H bash -c "cd '$APP_DIR' && npm ci --omit=dev && npm run check"

npm install --global pm2

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
systemctl enable --now fail2ban

sudo -u "$SERVICE_USER" -H bash -c "cd '$APP_DIR' && pm2 delete logbot >/dev/null 2>&1 || true; pm2 start ecosystem.config.cjs; pm2 save"
pm_path="$(command -v pm2)"
PATH="$PATH:$(dirname "$npm_path")" pm2 startup systemd -u "$SERVICE_USER" --hp "/home/$SERVICE_USER"
sudo -u "$SERVICE_USER" -H bash -c "pm2 save"

echo
echo "Kurulum tamamlandı. Durum:"
sudo -u "$SERVICE_USER" -H bash -c "pm2 status"
echo
echo "Logları görmek için: sudo -u $SERVICE_USER pm2 logs logbot"
