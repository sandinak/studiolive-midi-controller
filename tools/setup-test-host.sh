#!/bin/sh
#
# Set up a remote machine to build and run the hardware tests, so they stop
# taking over the developer's screen.
#
#   tools/setup-test-host.sh 192.168.1.245
#
# The host needs: ssh key access, Node and yarn on PATH, and a network path to
# the console. On macOS it also needs a logged-in session, because Electron
# wants a window server even when the window is never shown.
#
# Run it again after changing the app or the protocol fork — it re-syncs both.
#
# Two things make this more than `npm ci`:
#
#   The protocol fork is pinned as a git dependency, and it is the *patched*
#   fork we need rather than the pinned tag — without the TCP reframer fix a
#   console with stored content cannot be connected to at all, and without the
#   keep-alive fix a bulk transfer severs its own connection part way through.
#
#   The fork's `prepare` script rebuilds it on install, which needs a toolchain
#   (and devDependencies) a test host has no reason to carry. So the fork is
#   shipped as a packed tarball: `npm pack` includes only `dist`, and npm does
#   not run `prepare` for a tarball dependency, because a tarball is by
#   definition already prepared. Installing it as a directory instead runs
#   `prepare` even under `--ignore-scripts` and fails on the missing toolchain.
#
# The tarball is timestamped so npm cannot serve a stale cached copy of an
# unchanged version number.

set -e

HOST="$1"
[ -n "$HOST" ] || { echo "usage: $0 <host-or-ip>"; exit 2; }

APP_SRC="$(cd "$(dirname "$0")/.." && pwd)"
FORK_SRC="$(cd "$APP_SRC/../presonus-studiolive-api" 2>/dev/null && pwd)" || true
APP_DEST='~/studiolive-midi-controller'
STAMP="$(date +%Y%m%d%H%M%S)"
TARBALL="presonus-studiolive-api-$STAMP.tgz"

[ -n "$FORK_SRC" ] || { echo "Cannot find the protocol fork beside the app checkout."; exit 1; }

echo "==> checking $HOST"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" 'uname -sm' || {
  echo "Cannot ssh to $HOST with keys."; exit 1; }

echo "==> packing the protocol fork"
# `npm pack` runs the fork's own prepare, so this also guarantees the tarball
# carries a freshly built dist rather than whatever was last left in the tree.
PACKDIR="$(mktemp -d)"
trap 'rm -rf "$PACKDIR"' EXIT
( cd "$FORK_SRC" && npm pack --pack-destination "$PACKDIR" >/dev/null )
PACKED="$(ls "$PACKDIR"/*.tgz | head -1)"
[ -n "$PACKED" ] || { echo "npm pack produced nothing."; exit 1; }
mv "$PACKED" "$PACKDIR/$TARBALL"

echo "==> syncing the app"
ssh -o BatchMode=yes "$HOST" "mkdir -p $APP_DEST/vendor"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude release --exclude coverage \
  --exclude .git --exclude soak-results --exclude '*.bak' --exclude vendor \
  "$APP_SRC/" "$HOST:$APP_DEST/"
rsync -az "$PACKDIR/$TARBALL" "$HOST:$APP_DEST/vendor/"

echo "==> installing"
ssh -o BatchMode=yes "$HOST" "export PATH=/opt/homebrew/bin:\$PATH
set -e
cd $APP_DEST

# Keep only the tarball we just shipped, so a stale one cannot be resolved.
find vendor -name 'presonus-studiolive-api-*.tgz' ! -name '$TARBALL' -delete

python3 - <<PY
import json
p = 'package.json'
d = json.load(open(p))
d['dependencies']['presonus-studiolive-api'] = 'file:vendor/$TARBALL'
json.dump(d, open(p, 'w'), indent=2)
PY

rm -rf node_modules/presonus-studiolive-api
npm install --no-audit --no-fund >/dev/null

# Electron's postinstall does not always fetch the binary on a headless host;
# without it the harnesses have nothing to launch.
if [ ! -s node_modules/electron/path.txt ]; then
  echo '    fetching the Electron binary'
  node node_modules/electron/install.js
fi

npm run build >/dev/null
"

echo "==> verifying"
ssh -o BatchMode=yes "$HOST" "export PATH=/opt/homebrew/bin:\$PATH
cd $APP_DEST
node -e \"
const a = require('presonus-studiolive-api');
const need = ['sendFileRequest','downloadDocument','uploadDocument','deleteDocument'];
const missing = need.filter(m => typeof a.Client.prototype[m] !== 'function');
if (missing.length) { console.error('fork is missing: ' + missing.join(', ')); process.exit(1); }
console.log('protocol fork OK — all transfer methods present');
\"
node -e \"
const fs = require('fs');
const src = fs.readFileSync('node_modules/presonus-studiolive-api/dist/cjs/lib/Client.js', 'utf8');
if (!src.includes('keepAliveHelper?.updateTime()')) {
  console.error('fork is missing the keep-alive fix — a bulk transfer will sever itself');
  process.exit(1);
}
console.log('keep-alive liveness fix present');
\""

cat <<EOF

Ready. From here:

  ssh $HOST 'cd studiolive-midi-controller && node tools/backup-console.js <mixer-ip> -o /tmp/x.bak'
  ssh $HOST 'cd studiolive-midi-controller && node tools/hw-integration/run.js <mixer-ip>'

Take a restore point first, somewhere that is not a temp directory:

  node tools/backup-console.js <mixer-ip> -o ~/Documents/<model>-restorepoint.bak
EOF
