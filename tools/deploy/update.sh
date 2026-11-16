#!/bin/sh
# Deploys a commit (default main) of this repo to deche from this Mac: ships `git archive` and this checkout's
# vm-install.sh and units, the VM builds it and restarts aoe1web (docs/deploy.md). The pack is copied only when its version differs.
# Env: PACK_DIR (the built pack, default the deploy clone's), TOKEN_FILE (the tunnel token, first install only).
set -eu
ref=${1:-main}
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
PACK_DIR=${PACK_DIR:-$HOME/workspace/aoe1online/aoe1web-deploy/assets-local/pack}
vm="--zone asia-southeast1-c --project project-60754a51-b124-4c0e-982"
sha=$(git -C "$repo" rev-parse --short "$ref")
tmp=$(mktemp -d /tmp/aoe1web-deploy.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

git -C "$repo" archive -o "$tmp/release.tgz" "$ref"
here=$(cd "$(dirname "$0")" && pwd)
files="$tmp/release.tgz $here/vm-install.sh $here/aoe1web.service $here/cloudflared-aoe1web.service"
env="PACK_TGZ= TOKEN_SRC="

local_pack=$(head -c 40 "$PACK_DIR/manifest.json" | sed -n 's/.*"version":\([0-9]*\).*/\1/p')
up=/tmp/aoe1web-upload
remote_pack=$(gcloud compute ssh deche $vm --command "rm -rf $up && mkdir -m 700 $up && head -c 40 /opt/aoe1web/pack/manifest.json 2>/dev/null" | sed -n 's/.*"version":\([0-9]*\).*/\1/p')
echo "update: $ref ($sha), pack here v${local_pack:-none}, on deche v${remote_pack:-none}"
if [ "$local_pack" != "$remote_pack" ]; then
  [ -n "$local_pack" ] || { echo "update: no pack at $PACK_DIR" >&2; exit 1; }
  COPYFILE_DISABLE=1 tar --no-mac-metadata -C "$PACK_DIR" -czf "$tmp/pack.tgz" .
  files="$files $tmp/pack.tgz"
  env="$env PACK_TGZ=$up/pack.tgz"
fi
if [ -n "${TOKEN_FILE:-}" ]; then
  cp "$TOKEN_FILE" "$tmp/token"
  files="$files $tmp/token"
  env="$env TOKEN_SRC=$up/token"
fi

# shellcheck disable=SC2086
gcloud compute scp $vm $files deche:$up/
dir=/opt/aoe1web/releases/$sha
gcloud compute ssh deche $vm --command "set -e
  sudo rm -rf $dir && sudo mkdir -p $dir && sudo tar -xzf $up/release.tgz -C $dir
  sudo $env sh $up/vm-install.sh $dir || { rm -rf $up; exit 1; }; rm -rf $up"
