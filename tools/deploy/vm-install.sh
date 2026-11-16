#!/bin/sh
# Runs as root on deche: `vm-install.sh <release dir>`, a commit unpacked by tools/deploy/update.sh into
# /opt/aoe1web/releases/<sha>; the unit files are next to this script.
# Idempotent, also the first install: user aoe1web, Node 24 and cloudflared under /opt/aoe1web, npm ci + build,
# the pack (env PACK_TGZ) and tunnel token (env TOKEN_SRC) when given, the two systemd units, then the switch.
set -eu
base=/opt/aoe1web
release=$(cd "$1" && pwd)
units=$(cd "$(dirname "$0")" && pwd)
log() { echo "vm-install: $*"; }

id aoe1web >/dev/null 2>&1 || useradd --system --home-dir "$base" --shell /usr/sbin/nologin aoe1web
changed=
mkdir -p "$base/bin" "$base/releases" "$base/.npm" /etc/aoe1web
chown aoe1web:aoe1web "$base/.npm"

node_major=$("$base/node/bin/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
if [ "$node_major" != 24 ]; then
  url=https://nodejs.org/dist/latest-v24.x
  file=$(curl -fsSL "$url/SHASUMS256.txt" | awk '/linux-x64.tar.gz$/ {print $2}')
  curl -fsSL -o "/tmp/$file" "$url/$file"
  (cd /tmp && curl -fsSL "$url/SHASUMS256.txt" | grep " $file\$" | sha256sum -c -)
  rm -rf "$base/node" && mkdir "$base/node" && tar -xzf "/tmp/$file" -C "$base/node" --strip-components=1 && rm "/tmp/$file"
  log "installed node $("$base/node/bin/node" -v)"
fi
if [ ! -x "$base/bin/cloudflared" ]; then
  curl -fsSL -o "$base/bin/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod 755 "$base/bin/cloudflared"
  log "installed $("$base/bin/cloudflared" --version)"
fi
if [ -n "${TOKEN_SRC:-}" ]; then
  install -m 640 -o root -g aoe1web "$TOKEN_SRC" /etc/aoe1web/tunnel.token && changed=" cloudflared-aoe1web"
  log "tunnel token installed"
fi
[ -s /etc/aoe1web/tunnel.token ] || { log "no /etc/aoe1web/tunnel.token: run update.sh with TOKEN_FILE once" >&2; exit 1; }

chown -R aoe1web:aoe1web "$release"
export PATH="$base/node/bin:$PATH"
(cd "$release" && runuser -u aoe1web -- env HOME="$base" PATH="$PATH" NODE_OPTIONS=--max-old-space-size=1536 \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build --silent') > "$release.build.log" 2>&1 \
  || { tail -30 "$release.build.log" >&2; exit 1; }
log "built $(basename "$release")"

if [ -n "${PACK_TGZ:-}" ]; then
  rm -rf "$base/pack.new" && mkdir "$base/pack.new" && tar -xzf "$PACK_TGZ" -C "$base/pack.new"
  chown -R aoe1web:aoe1web "$base/pack.new"
  rm -rf "$base/pack.old"; [ -d "$base/pack" ] && mv "$base/pack" "$base/pack.old"; mv "$base/pack.new" "$base/pack"; rm -rf "$base/pack.old"
  log "pack $(head -c 20 "$base/pack/manifest.json")"
fi

ln -sfn "$release" "$base/current.new" && mv -T "$base/current.new" "$base/current"

for unit in aoe1web cloudflared-aoe1web; do
  cmp -s "$units/$unit.service" "/etc/systemd/system/$unit.service" || { install -m 644 "$units/$unit.service" /etc/systemd/system/; changed="$changed $unit"; }
done
systemctl daemon-reload
systemctl enable --quiet aoe1web cloudflared-aoe1web
systemctl restart aoe1web
case "$changed" in *cloudflared*) systemctl restart cloudflared-aoe1web ;; *) systemctl start cloudflared-aoe1web ;; esac
for _ in $(seq 30); do curl -fs http://localhost:8790/health >/dev/null && break; sleep 1; done
log "health $(curl -fsS http://localhost:8790/health)"

# Keep the current release and the one before it.
ls -1dt "$base"/releases/*/ | tail -n +3 | while read -r old; do [ "${old%/}" = "$release" ] || rm -rf "${old%/}" "${old%/}.build.log"; done
log "active: $(systemctl is-active aoe1web cloudflared-aoe1web | tr '\n' ' ')"
