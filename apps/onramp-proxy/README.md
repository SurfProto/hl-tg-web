# Onramp Egress Proxy

Small Node.js proxy for routing onramp provider calls through a VPS with a stable public IPv4.

## Environment

Create `/etc/onramp-proxy.env` on the VPS:

```env
HOST=0.0.0.0
PORT=8080
ONRAMP_PROVIDER_BASE_URL=https://moonlander-dev.tsunami.cash
ONRAMP_CLIENT_ID=your_provider_client_id
ONRAMP_SECRET=your_provider_secret
ONRAMP_PROXY_TOKEN=shared_secret_between_vercel_and_proxy
```

Set the same `ONRAMP_PROXY_TOKEN` in Vercel. Set Vercel `ONRAMP_BASE_URL` to the proxy URL, for the smoke test:

```env
ONRAMP_BASE_URL=http://your_vps_static_ip:8080
```

## Install

```bash
sudo mkdir -p /opt/onramp-proxy
sudo cp -r apps/onramp-proxy/* /opt/onramp-proxy/
cd /opt/onramp-proxy
npm install --omit=dev
```

For this package there are no runtime dependencies; `npm install` is only needed if dependencies are added later.

## Systemd

Create `/etc/systemd/system/onramp-proxy.service`:

```ini
[Unit]
Description=Onramp egress proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/onramp-proxy
EnvironmentFile=/etc/onramp-proxy.env
ExecStart=/usr/bin/node /opt/onramp-proxy/src/server.mjs
Restart=always
RestartSec=5
User=onramp-proxy
Group=onramp-proxy
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Then start it:

```bash
sudo useradd --system --home /opt/onramp-proxy --shell /usr/sbin/nologin onramp-proxy
sudo chown -R onramp-proxy:onramp-proxy /opt/onramp-proxy
sudo systemctl daemon-reload
sudo systemctl enable --now onramp-proxy
sudo systemctl status onramp-proxy
```

## Smoke Tests

Without a token, the proxy must reject:

```bash
curl -i http://your_vps_static_ip:8080/externals/cex/precalc
```

With the token, the request should reach the provider and return JSON or a provider JSON error:

```bash
curl -i http://your_vps_static_ip:8080/externals/cex/precalc \
  -H 'Content-Type: application/json' \
  -H 'X-Onramp-Proxy-Token: shared_secret_between_vercel_and_proxy' \
  -d '{"amount":1000,"direction":"FORWARD","fee_strategy":"SERVICE","service_id":"your_onramp_service_id","symbol":"RUB-USDT"}'
```

After the smoke test works, put the proxy behind HTTPS with Caddy or Nginx, update Vercel `ONRAMP_BASE_URL` to the HTTPS URL, and close public access to raw port `8080`.
