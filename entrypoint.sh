#!/bin/sh
set -e

# Sync baked-in Omniclaw plugin to the mounted extensions directory.
# This runs on every boot to ensure the plugin is present even when
# the ~/.openclaw directory is a bind mount from the host.
EXTENSIONS_DIR="/home/node/.openclaw/extensions"
PLUGIN_SRC="/opt/omniclaw/plugin"

if [ -d "$PLUGIN_SRC" ]; then
    mkdir -p "$EXTENSIONS_DIR"
    if [ ! -d "$EXTENSIONS_DIR/omniclaw/dist" ]; then
        echo "[entrypoint] Copying Omniclaw plugin to $EXTENSIONS_DIR/omniclaw..."
        cp -a "$PLUGIN_SRC" "$EXTENSIONS_DIR/omniclaw"
        echo "[entrypoint] Omniclaw plugin installed."
    else
        echo "[entrypoint] Omniclaw plugin already present, skipping copy."
    fi
fi

# Hand off to the CMD
exec "$@"
