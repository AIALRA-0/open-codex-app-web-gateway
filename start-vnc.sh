#!/usr/bin/env bash
set -euo pipefail

display="${CODEXAPP_DISPLAY:-42}"
rfb_port="${CODEXAPP_RFB_PORT:-5942}"
web_port="${CODEXAPP_WEB_PORT:-12910}"
geometry="${CODEXAPP_GEOMETRY:-1600x1000}"
host="$(hostname)"

vncserver -kill ":${display}" >/dev/null 2>&1 || true
pkill -u "aialra" -f "Xtigervnc :${display}" >/dev/null 2>&1 || true
pkill -u "aialra" -f "websockify .*${web_port}" >/dev/null 2>&1 || true
rm -f "/home/aialra/.vnc/${host}:${display}.pid" \
      "/home/aialra/.vnc/${host}:${rfb_port}.pid" \
      "/tmp/.X${display}-lock" \
      "/tmp/.X11-unix/X${display}" || true

vncserver ":${display}" \
  -localhost yes \
  -SecurityTypes None \
  -rfbport "${rfb_port}" \
  -geometry "${geometry}" \
  -depth 24 \
  -xstartup /srv/aialra/apps/codexapp/xstartup.sh &

for _ in {1..150}; do
  if timeout 1 bash -c "</dev/tcp/127.0.0.1/${rfb_port}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

exec /usr/bin/websockify --web=/usr/share/novnc "127.0.0.1:${web_port}" "127.0.0.1:${rfb_port}"
