#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
}

prompt() {
  local label="$1"
  local default="${2:-}"
  local value
  if [ -n "$default" ]; then
    read -r -p "$label [$default]: " value
    printf '%s' "${value:-$default}"
  else
    read -r -p "$label: " value
    printf '%s' "$value"
  fi
}

secret_hex() {
  openssl rand -hex "${1:-32}"
}

require_linux() {
  if [ "$(uname -s)" != "Linux" ]; then
    echo "This script must be run on the Ubuntu VPS."
    exit 1
  fi
}

install_base_packages() {
  sudo apt update
  sudo apt install -y ca-certificates curl gnupg ufw htop unzip openssl
}

install_docker() {
  if need_cmd docker; then
    return
  fi
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
}

install_caddy() {
  if need_cmd caddy; then
    return
  fi
  sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
  sudo rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
    sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt update
  sudo apt install -y caddy
}

write_env() {
  local domain="$1"
  local admin_email="$2"
  local admin_password="$3"
  local adspower_api_key="$4"
  local openai_api_key="$5"

  local db_password auth_secret
  db_password="$(secret_hex 24)"
  auth_secret="$(secret_hex 64)"

  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d%H%M%S)"
  fi

  cat >"$ENV_FILE" <<EOF
DATABASE_URL="postgresql://legends:${db_password}@127.0.0.1:5433/legends_comments"
POSTGRES_USER="legends"
POSTGRES_PASSWORD="${db_password}"
POSTGRES_DB="legends_comments"
PORT="3000"
HOSTNAME="127.0.0.1"
AUTH_SECRET="${auth_secret}"
ADMIN_EMAIL="${admin_email}"
ADMIN_PASSWORD="${admin_password}"

ADSPOWER_API_URL="http://127.0.0.1:50325"
ADSPOWER_API_KEY="${adspower_api_key}"
FARM_QUEUE_MAX_PARALLEL="20"

OPENAI_API_KEY="${openai_api_key}"
OPENAI_MODEL="gpt-4o-mini"

PUBLIC_APP_URL="https://${domain}"
EOF

  chmod 600 "$ENV_FILE"
}

configure_caddy() {
  local domain="$1"
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${domain} {
	encode gzip zstd
	reverse_proxy 127.0.0.1:3000
}
EOF
  sudo systemctl enable caddy >/dev/null
  sudo systemctl reload caddy || sudo systemctl restart caddy
}

configure_firewall() {
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw deny 3000/tcp || true
  sudo ufw deny 50325/tcp || true
  sudo ufw --force enable
}

configure_adspower_service() {
  local api_key="$1"
  if [ -z "$api_key" ]; then
    echo "AdsPower API key is empty; skipping AdsPower systemd service."
    return
  fi
  if ! need_cmd adspower_global; then
    echo "adspower_global was not found. Install AdsPower Linux .deb, then rerun this script."
    return
  fi

  sudo tee /etc/systemd/system/adspower.service >/dev/null <<EOF
[Unit]
Description=AdsPower headless Local API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=ADSPOWER_API_KEY=${api_key}
ExecStart=/usr/bin/env adspower_global --headless=true --api-key=\${ADSPOWER_API_KEY} --api-port=50325
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now adspower
}

start_app() {
  cd "$APP_DIR"
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d --build
  else
    sudo docker compose up -d --build
  fi
}

main() {
  require_linux
  cd "$APP_DIR"

  echo "Legends Comments VPS setup"
  echo
  local domain admin_email admin_password adspower_api_key openai_api_key
  domain="$(prompt "Domain, for example app.example.com")"
  if [ -z "$domain" ]; then
    echo "Domain is required."
    exit 1
  fi
  admin_email="$(prompt "Admin email" "admin@${domain}")"
  admin_password="$(prompt "Admin password" "$(secret_hex 12)")"
  adspower_api_key="$(prompt "AdsPower API key, can be empty for now" "")"
  openai_api_key="$(prompt "OpenAI API key, can be empty" "")"

  install_base_packages
  install_docker
  install_caddy
  write_env "$domain" "$admin_email" "$admin_password" "$adspower_api_key" "$openai_api_key"
  configure_firewall
  configure_adspower_service "$adspower_api_key"
  start_app
  configure_caddy "$domain"

  echo
  echo "Done."
  echo "URL: https://${domain}"
  echo "Admin: ${admin_email}"
  echo "Password: ${admin_password}"
  echo
  echo "If DNS was just changed, wait until the A record points to this VPS, then Caddy will issue HTTPS automatically."
}

main "$@"
