#!/bin/sh
#
# Set up a remote machine to run the hardware tests, so they stop taking over
# the developer's screen.
#
#   tools/setup-test-host.sh 192.168.21.136
#
# The host needs: ssh key access, Homebrew (macOS) or apt (Linux), and a network
# path to the console. On macOS it also needs a logged-in session, because
# Electron wants a window server even when the window is hidden.
#
# Run it again after changing the app or the protocol fork — it re-syncs both.
#
# Two things make this more than `npm ci`:
#
#   The protocol fork is pinned as a git dependency whose `prepare` script
#   rebuilds it on install, and that build needs a toolchain a test box will not
#   have. It is also the *patched* fork we need, not the pinned tag — without
#   the TCP reframer fix a console with stored content cannot be connected to at
#   all. So the fork is rsynced with its `dist` already built and wired in as a
#   `file:` dependency with scripts skipped.
#
#   A `file:` dependency is symlinked, so the fork resolves its own runtime deps
#   from its own node_modules. Those have to be installed in the fork directory,
#   not the app's.

set -e

HOST="$1"
[ -n "$HOST" ] || { echo "usage: $0 <host-or-ip>"; exit 2; }

APP_SRC="$(cd "$(dirname "$0")/.." && pwd)"
FORK_SRC="$(cd "$APP_SRC/../presonus-studiolive-api" 2>/dev/null && pwd)" || true
APP_DEST='~/studiolive-midi-controller'
FORK_DEST='~/presonus-studiolive-api'

[ -n "$FORK_SRC" ] || { echo "Cannot find the protocol fork beside the app checkout."; exit 1; }
[ -d "$FORK_SRC/dist" ] || {
  echo "The fork has no dist/. Build it first:  (cd $FORK_SRC && npm run build)"
  exit 1
}

echo "==> checking $HOST"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" 'uname -sm' || {
  echo "Cannot ssh to $HOST with keys."; exit 1; }

echo "==> syncing the app"
ssh -o BatchMode=yes "$HOST" "mkdir -p $APP_DEST $FORK_DEST"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude release --exclude coverage \
  --exclude .git --exclude soak-results --exclude '*.bak' \
  "$APP_SRC/" "$HOST:$APP_DEST/"

echo "==> syncing the protocol fork, with its built dist"
rsync -az --delete \
  --exclude node_modules --exclude .git \
  --exclude studiolive-midi-controller --exclude midi-controller-src \
  "$FORK_SRC/" "$HOST:$FORK_DEST/"

echo "==> installing"
ssh -o BatchMode=yes "$HOST" "export PATH=/opt/homebrew/bin:\$PATH
set -e
cd $FORK_DEST
# --omit=dev: the fork's dist is prebuilt, so none of its build tooling is needed.
npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null

cd $APP_DEST
python3 - <<'PY'
import json
p = 'package.json'
d = json.load(open(p))
d['dependencies']['presonus-studiolive-api'] = 'file:../presonus-studiolive-api'
json.dump(d, open(p, 'w'), indent=2)
PY
npm install --ignore-scripts --no-audit --no-fund >/dev/null
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
\""

cat <<EOF

Ready. From here:

  ssh $HOST 'cd studiolive-midi-controller && node tools/backup-console.js <mixer-ip> -o /tmp/x.bak'
  ssh $HOST 'cd studiolive-midi-controller && node tools/hw-integration/run.js <mixer-ip>'

Take a restore point first, somewhere that is not a temp directory:

  node tools/backup-console.js <mixer-ip> -o ~/Documents/<model>-restorepoint.bak
EOF
