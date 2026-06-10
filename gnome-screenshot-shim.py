#!/usr/bin/env python3
import os
import subprocess
import tempfile

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib


INTROSPECTION_XML = """
<node>
  <interface name="org.gnome.Shell.Screenshot">
    <method name="Screenshot">
      <arg type="b" name="include_cursor" direction="in"/>
      <arg type="b" name="flash" direction="in"/>
      <arg type="s" name="filename" direction="in"/>
      <arg type="b" name="success" direction="out"/>
      <arg type="s" name="filename_used" direction="out"/>
    </method>
    <method name="ScreenshotWindow">
      <arg type="b" name="include_frame" direction="in"/>
      <arg type="b" name="include_cursor" direction="in"/>
      <arg type="b" name="flash" direction="in"/>
      <arg type="s" name="filename" direction="in"/>
      <arg type="b" name="success" direction="out"/>
      <arg type="s" name="filename_used" direction="out"/>
    </method>
    <method name="ScreenshotArea">
      <arg type="i" name="x" direction="in"/>
      <arg type="i" name="y" direction="in"/>
      <arg type="i" name="width" direction="in"/>
      <arg type="i" name="height" direction="in"/>
      <arg type="b" name="flash" direction="in"/>
      <arg type="s" name="filename" direction="in"/>
      <arg type="b" name="success" direction="out"/>
      <arg type="s" name="filename_used" direction="out"/>
    </method>
  </interface>
</node>
"""


def choose_filename(filename):
  if filename:
    return filename
  fd, path = tempfile.mkstemp(prefix="codex-gnome-screenshot-", suffix=".png")
  os.close(fd)
  return path


def capture_fullscreen(filename):
  path = choose_filename(filename)
  directory = os.path.dirname(path)
  if directory:
    os.makedirs(directory, exist_ok=True)

  subprocess.run(
    ["xfce4-screenshooter", "-f", "-s", path],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    timeout=10,
    check=True,
  )
  return os.path.exists(path) and os.path.getsize(path) > 0, path


def handle_method(_connection, _sender, _object_path, _interface, method, parameters, invocation):
  try:
    if method == "Screenshot":
      _include_cursor, _flash, filename = parameters.unpack()
    elif method == "ScreenshotWindow":
      _include_frame, _include_cursor, _flash, filename = parameters.unpack()
    elif method == "ScreenshotArea":
      _x, _y, _width, _height, _flash, filename = parameters.unpack()
    else:
      invocation.return_dbus_error(
        "org.gnome.Shell.Screenshot.Error.NotImplemented",
        f"Unsupported method: {method}",
      )
      return

    ok, path = capture_fullscreen(filename)
    invocation.return_value(GLib.Variant("(bs)", (ok, path if ok else "")))
  except Exception as error:
    invocation.return_dbus_error("org.gnome.Shell.Screenshot.Error.Failed", str(error))


def main():
  node = Gio.DBusNodeInfo.new_for_xml(INTROSPECTION_XML)
  loop = GLib.MainLoop()

  def on_bus_acquired(connection, _name):
    connection.register_object(
      "/org/gnome/Shell/Screenshot",
      node.interfaces[0],
      handle_method,
      None,
      None,
    )

  Gio.bus_own_name(
    Gio.BusType.SESSION,
    "org.gnome.Shell.Screenshot",
    Gio.BusNameOwnerFlags.NONE,
    on_bus_acquired,
    None,
    None,
  )
  loop.run()


if __name__ == "__main__":
  main()
