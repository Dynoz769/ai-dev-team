#!/bin/bash
# Double-click to start AI Dev Team on a Mac.
cd "$(dirname "$0")" || exit 1
echo
echo "  AI Dev Team"
echo "  ==========="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed yet."
  echo "  Opening the download page: install the \"LTS\" version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "  Press Enter to close." _
  exit 1
fi
if ! node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"; then
  echo "  Your Node.js is too old. Version 22 or newer is needed."
  open "https://nodejs.org/en/download"
  read -r -p "  Press Enter to close." _
  exit 1
fi
if ! git --version >/dev/null 2>&1; then
  echo "  Git is needed. macOS will now offer to install the developer tools that include it."
  echo "  Click Install, wait for it to finish, then double-click this file again."
  xcode-select --install 2>/dev/null
  read -r -p "  Press Enter to close." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  First start: installing, this takes a minute..."
  npm install --no-fund --no-audit || { echo "  Installing failed. Check your internet connection and try again."; read -r -p "  Press Enter to close." _; exit 1; }
fi

(sleep 4 && open "http://localhost:3000") &
npm start --silent
