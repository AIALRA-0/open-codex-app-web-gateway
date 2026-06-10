#!/usr/bin/env bash
set -euo pipefail

display="${CODEXAPP_DISPLAY:-42}"
rfb_port="${CODEXAPP_RFB_PORT:-5942}"
web_port="${CODEXAPP_WEB_PORT:-12910}"
host="$(hostname)"

pkill -u "aialra" -f "websockify .*${web_port}" >/dev/null 2>&1 || true
pkill -u "aialra" -f "codex-desktop|/opt/codex-desktop/electron" >/dev/null 2>&1 || true
vncserver -kill ":${display}" >/dev/null 2>&1 || true
pkill -u "aialra" -f "Xtigervnc :${display}" >/dev/null 2>&1 || true
rm -f "/home/aialra/.vnc/${host}:${display}.pid" \
      "/home/aialra/.vnc/${host}:${rfb_port}.pid" \
      "/tmp/.X${display}-lock" \
      "/tmp/.X11-unix/X${display}" || true
