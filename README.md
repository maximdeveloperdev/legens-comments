# Legends Comments

Internal automation panel for AdsPower/Facebook comment and like workflows.

Stack:

- Next.js App Router
- React
- Prisma
- PostgreSQL
- AdsPower Local API
- Playwright over AdsPower CDP

## Local Development

Install dependencies:

```bash
npm ci
```

Create local env:

```bash
cp .env.example .env
```

Start Postgres:

```bash
docker compose up -d postgres
```

Prepare the database:

```bash
npm run db:setup
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment

Use `.env.example` for local development and `.env.vps.example` for production VPS setup.

Important values:

- `DATABASE_URL`
- `AUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADSPOWER_API_URL`
- `ADSPOWER_API_KEY`
- `FARM_QUEUE_MAX_PARALLEL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Never commit real `.env` files or API keys.

## Production Build

```bash
npm run lint
npm run build
```

## VPS Deploy with AdsPower

Target server: Ubuntu 24.04/22.04, Docker Compose, AdsPower running on the host in headless Local API mode.

### 1. Prepare the server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg ufw htop unzip

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
sudo ufw enable
```

Do not open AdsPower Local API port `50325` to the internet. The app talks to AdsPower through `127.0.0.1`.

### 2. Install AdsPower on the VPS

Download the current Linux `.deb` from the official AdsPower download page:

```bash
cd /tmp
# Replace the file name with the newest Linux package from https://www.adspower.com/download
sudo dpkg -i AdsPower-Global-*-x64.deb || sudo apt --fix-broken install -y
```

Create a systemd service:

```bash
sudo tee /etc/systemd/system/adspower.service >/dev/null <<'EOF'
[Unit]
Description=AdsPower headless Local API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=ADSPOWER_API_KEY=PASTE_ADSPOWER_API_KEY_HERE
ExecStart=/usr/bin/env adspower_global --headless=true --api-key=${ADSPOWER_API_KEY} --api-port=50325
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now adspower
sudo systemctl status adspower --no-pager
```

Check Local API:

```bash
curl -H "Authorization: Bearer $ADSPOWER_API_KEY" http://127.0.0.1:50325/status
```

### 3. Deploy the app

Copy the project to the server, then create the environment file:

```bash
cp .env.vps.example .env
nano .env
```

Required production values:

```env
DATABASE_URL="postgresql://legends:replace-with-strong-db-password@127.0.0.1:5433/legends_comments"
POSTGRES_USER="legends"
POSTGRES_PASSWORD="replace-with-strong-db-password"
POSTGRES_DB="legends_comments"
AUTH_SECRET="replace-with-long-random-secret"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="replace-with-strong-password"
ADSPOWER_API_URL="http://127.0.0.1:50325"
ADSPOWER_API_KEY=""
FARM_QUEUE_MAX_PARALLEL="20"
OPENAI_API_KEY="optional-openai-key"
```

Build and run:

```bash
docker compose up -d --build
docker compose logs -f web
```

Open:

```text
http://SERVER_IP:3000
```

### 4. Runtime notes

`docker-compose.yml` runs the web container in host network mode so it can reach AdsPower on `127.0.0.1:50325`. Postgres still runs in Docker and is exposed only on the server as `127.0.0.1:5433` from the app perspective.

Start with:

```env
FARM_QUEUE_MAX_PARALLEL="20"
```

For Cloud VPS Plus 18, raise it gradually to `25` or `30` only after checking RAM, CPU load, AdsPower stability, and Facebook timeouts.
