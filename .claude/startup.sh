#!/bin/bash
# Restore clasp credentials and install clasp for Claude Code remote sessions

if [ -n "$CLASPRC_JSON" ]; then
  echo "$CLASPRC_JSON" > "$HOME/.clasprc.json"
  echo "[startup] clasp credentials restored from CLASPRC_JSON"
else
  echo "[startup] CLASPRC_JSON not set — clasp deploy won't be available"
fi

if ! command -v clasp &>/dev/null; then
  npm install -g @google/clasp --silent
  echo "[startup] clasp installed"
fi
