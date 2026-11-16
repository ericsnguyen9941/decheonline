# Deploy: aoe.signalsradar.space on deche

The public site runs on the Google Compute Engine VM `deche` (Debian 13, x86_64, 2 vCPU, 2 GB), not on a Mac.
Every remote step goes through gcloud:

```sh
gcloud compute ssh --zone "asia-southeast1-c" "deche" --project "project-60754a51-b124-4c0e-982"
```

## What runs where

- Cloudflare: tunnel `aoe1web` (id `4ce584f4-45e4-41f6-b77e-6ca49890752f`, remotely managed; ingress
  `aoe.signalsradar.space` → `http://localhost:8790`, anything else 404) and the proxied DNS record `aoe` (CNAME to the
  tunnel). TLS ends at Cloudflare; the VM opens no public port.
- On deche, everything under `/opt/aoe1web`, owned by the system user `aoe1web`:
  - `node/` Node 24 (nodejs.org tarball), `bin/cloudflared`; nothing installed through apt.
  - `releases/<sha>/` a commit of this repo, built on the VM (`npm ci && npm run build`); `current` links to the live one,
    the previous one is kept.
  - `pack/` the asset pack (`assets-local/pack` built on the Mac from the original files; `ASSETS_DIR`).
  - `/etc/aoe1web/tunnel.token` the tunnel token (root:aoe1web 640, never in git).
- systemd units (templates in `tools/deploy/`): `aoe1web` (the production server, `npm run start`'s
  `apps/server/dist/main.js`, `PORT=8790`, reachable from localhost only) and `cloudflared-aoe1web` (the connector).
  Both are enabled at boot and restart on failure.

## Update

From a Mac checkout of this repo with the built pack:

```sh
tools/deploy/update.sh          # deploys local main; `tools/deploy/update.sh <ref>` another commit
```

It ships `git archive <ref>` and this checkout's `tools/deploy/{vm-install.sh,*.service}`; on the VM `vm-install.sh`
builds the release, switches `current`, rewrites the units if they changed and restarts `aoe1web` (a few seconds of
downtime; games in progress are dropped). The pack is copied only when its `version` differs from the VM's: env
`PACK_DIR`, default `~/workspace/aoe1online/aoe1web-deploy/assets-local/pack` (rebuild it with
`AOE1_DIR=<install> npm run assets:import` there when main bumps the pack version). The first install also passes
`TOKEN_FILE=<token file>`; Node and cloudflared are downloaded when missing.

## Operate

```sh
G='gcloud compute ssh --zone asia-southeast1-c deche --project project-60754a51-b124-4c0e-982 --command'
$G 'systemctl is-active aoe1web cloudflared-aoe1web'
$G 'sudo journalctl -u aoe1web -n 100 --no-pager'            # or -u cloudflared-aoe1web
$G 'sudo systemctl restart aoe1web cloudflared-aoe1web'
$G 'sudo systemctl stop cloudflared-aoe1web aoe1web'          # take the site down; `start` brings it back
$G 'curl -s localhost:8790/health'
```

Rollback: `$G 'sudo ln -sfn /opt/aoe1web/releases/<previous sha> /opt/aoe1web/current && sudo systemctl restart aoe1web'`.
