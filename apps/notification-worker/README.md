# Notification Worker

Long-running Telegram notifications worker for production delivery. This worker runs outside Vercel and polls Hyperliquid + Supabase on an interval.

## Runtime Environment

The worker requires these environment variables:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
VITE_HYPERLIQUID_TESTNET=false
NOTIFICATION_POLL_INTERVAL_MS=15000
NOTIFICATION_DELIVERY_BATCH_SIZE=50
NOTIFICATION_RUN_ONCE=false
```

Use [deploy/hl-notification-worker.env.example](./deploy/hl-notification-worker.env.example) as the VPS template.

## Production Topology

- Vercel hosts the mini app and API routes.
- The VPS hosts this worker as a `systemd` service.
- Production notifications should not rely on a Vercel cron schedule in this phase.

## VPS Install

Deploy the full repo checkout to `/opt/hl-tg-web`, because this worker runs from the pnpm workspace root.

```bash
sudo mkdir -p /opt/hl-tg-web
sudo chown -R "$USER":"$USER" /opt/hl-tg-web
git clone <your-repo-url> /opt/hl-tg-web
cd /opt/hl-tg-web
git checkout <intended-commit>
sudo corepack enable
sudo corepack prepare pnpm@9.1.0 --activate
pnpm install --frozen-lockfile
```

Create the service user and env file:

```bash
sudo useradd --system --home /opt/hl-tg-web --shell /usr/sbin/nologin hl-notification-worker
sudo cp apps/notification-worker/deploy/hl-notification-worker.env.example /etc/hl-notification-worker.env
sudo chown root:root /etc/hl-notification-worker.env
sudo chmod 600 /etc/hl-notification-worker.env
sudo chown -R hl-notification-worker:hl-notification-worker /opt/hl-tg-web
```

Create the `systemd` unit from [deploy/hl-notification-worker.service](./deploy/hl-notification-worker.service):

```bash
sudo cp apps/notification-worker/deploy/hl-notification-worker.service /etc/systemd/system/hl-notification-worker.service
sudo systemctl daemon-reload
```

## Supabase Preconditions

Before first start, verify production Supabase already contains:

- `notification_preferences`
- `notification_channels`
- `notification_events`
- `notification_runtime_state`

Use [deploy/verify-notification-schema.sql](./deploy/verify-notification-schema.sql) in the Supabase SQL editor or via your normal SQL path.

## Smoke Test

Run a one-shot foreground pass before enabling the service:

```bash
cd /opt/hl-tg-web
set -a
source /etc/hl-notification-worker.env
set +a
export NOTIFICATION_RUN_ONCE=true
pnpm --filter @repo/notification-worker start
```

Expected result:

- process exits cleanly
- Supabase reads succeed
- Telegram channel rows can be created or updated
- no fatal startup error

Then enable the long-running service:

```bash
sudo systemctl enable --now hl-notification-worker
sudo systemctl status hl-notification-worker
sudo journalctl -u hl-notification-worker -f
```

## Verification Checklist

1. `pnpm --filter @repo/notification-worker test`
2. one-shot run with `NOTIFICATION_RUN_ONCE=true`
3. `systemctl status hl-notification-worker` reports healthy
4. `journalctl -u hl-notification-worker` shows steady loops without restart churn
5. a known Telegram user with enabled prefs receives at least one notification

## Rollback

```bash
sudo systemctl stop hl-notification-worker
sudo systemctl disable hl-notification-worker
```

This rollback leaves Vercel and the database unchanged.
