#!/usr/bin/env sh
# Lux installer. Works on macOS, Linux, and Windows (Git Bash / WSL).
# One line:
#   curl -fsSL https://raw.githubusercontent.com/darksomaX/Lux/main/install.sh | sh
#
# Or, to read it first (recommended over the pipe-to-sh form):
#   curl -fsSL https://raw.githubusercontent.com/darksomaX/Lux/main/install.sh -o install.sh
#   sh install.sh
#
# Clones Lux into ./lux, installs deps, builds the client bundles, and prints
# the command to start it. Requires git and Node 18+.

set -e

REPO="https://github.com/darksomaX/Lux"
DIR="lux"

# --- helpers ----------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

echo "Lux installer"
echo "-------------"

# --- checks -----------------------------------------------------------------
if ! have git; then
  echo "git is required. Install it from https://git-scm.com/ and re-run."
  exit 1
fi
if ! have node; then
  echo "Node.js 18+ is required. Install it from https://nodejs.org/ and re-run."
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node 18+ required, found $(node -v). Upgrade at https://nodejs.org/."
  exit 1
fi

# --- clone ------------------------------------------------------------------
if [ -d "$DIR" ]; then
  echo "Directory ./$DIR exists. Pulling latest..."
  cd "$DIR"
  git pull --rebase
else
  echo "Cloning $REPO into ./$DIR ..."
  git clone --depth 1 "$REPO" "$DIR"
  cd "$DIR"
fi

# --- install + build --------------------------------------------------------
echo "Installing dependencies (this can take a minute)..."
npm install

echo "Building client bundles..."
npm run build

# --- done -------------------------------------------------------------------
PORT="${PORT:-8080}"
cat <<EOF

Done. Start Lux with:

  cd $DIR && npm start

Then open http://localhost:$PORT in Chromium.
The first-run unlock phrase is the single letter: a
Change it in Settings (gear icon, top-left) before relying on it.

To host it for others, put it behind nginx or Caddy with TLS. See the README.
EOF
