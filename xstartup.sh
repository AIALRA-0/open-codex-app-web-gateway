#!/usr/bin/env bash
set -euo pipefail

export LANG=zh_CN.UTF-8
export LANGUAGE=zh_CN:zh
export LC_ALL=zh_CN.UTF-8
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=XFCE
export DESKTOP_SESSION=xfce
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
export SDL_IM_MODULE=fcitx
export NO_AT_BRIDGE=0
export GTK_MODULES="${GTK_MODULES:+${GTK_MODULES}:}gail:atk-bridge"
export QT_ACCESSIBILITY=1
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export CODEX_FORCE_RENDERER_ACCESSIBILITY=1

unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS

display_base="${DISPLAY:-:42}"
display_base="${display_base%%.*}"
display_num="${display_base#:}"

rm -f "${HOME}/.cache/sessions/"xfce4-session-*":${display_num}"* \
      "${HOME}/.cache/sessions/"xfwm4-*.state \
      "${HOME}/.ICEauthority.lock" \
      "${HOME}/.Xauthority.lock" 2>/dev/null || true

exec dbus-run-session -- bash -lc '
set -euo pipefail
trap "jobs -pr | xargs -r kill >/dev/null 2>&1 || true" EXIT INT TERM

mkdir -p "$HOME/.cache/codexapp" "$HOME/.config/codex-desktop"

gsettings set org.gnome.desktop.interface toolkit-accessibility true >/dev/null 2>&1 || true
gdbus call --session \
  --dest org.a11y.Bus \
  --object-path /org/a11y/bus \
  --method org.freedesktop.DBus.Properties.Set \
  org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true

python3 /srv/aialra/apps/codexapp/gnome-screenshot-shim.py \
  >>"$HOME/.cache/codexapp/gnome-screenshot-shim.log" 2>&1 &

if command -v fcitx5 >/dev/null 2>&1 && ! pgrep -u "$USER" -x fcitx5 >/dev/null 2>&1; then
  fcitx5 -d >/dev/null 2>&1 &
fi

xfsettingsd --display "$DISPLAY" >/dev/null 2>&1 &
if command -v i3 >/dev/null 2>&1; then
  i3 -c /srv/aialra/apps/codexapp/i3.config >>"$HOME/.cache/codexapp/i3.log" 2>&1 &
else
  xfwm4 --replace --display "$DISPLAY" >/dev/null 2>&1 &
fi
xsetroot -solid "#f6f7f8" >/dev/null 2>&1 || true

while true; do
  if command -v codex-desktop >/dev/null 2>&1; then
    CODEX_HOME="$HOME/.codex" codex-desktop --x11 --new-chat >>"$HOME/.cache/codexapp/codex-desktop.log" 2>&1 || true
  else
    echo "codex-desktop binary is not installed yet" >>"$HOME/.cache/codexapp/codex-desktop.log"
  fi
  sleep 2
done &

wait
'
