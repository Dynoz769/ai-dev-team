#!/bin/bash
# Start AI Dev Team on Linux: ./start-linux.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Install Node.js 22+ first: https://nodejs.org"; exit 1; }
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)" || { echo "Node.js 22 or newer is needed: https://nodejs.org"; exit 1; }
command -v git >/dev/null || { echo "Install git first (e.g. sudo apt install git)"; exit 1; }
[ -d node_modules ] || npm install --no-fund --no-audit || exit 1
(sleep 4 && (xdg-open "http://localhost:3000" >/dev/null 2>&1 || true)) &
npm start --silent
