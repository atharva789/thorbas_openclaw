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

# Auto-select model provider based on available API keys.
# Priority (when multiple keys present): gemini > anthropic > openai
CONFIG_FILE="/home/node/.openclaw/openclaw.json"
if [ -f "$CONFIG_FILE" ]; then
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        MODEL="anthropic/claude-sonnet-4-5"
    elif [ -n "$GEMINI_API_KEY" ]; then
        MODEL="google/gemini-2.5-flash"
    elif [ -n "$OPENAI_API_KEY" ]; then
        MODEL="openai/gpt-4o"
    else
        MODEL=""
    fi

    # Build fallback list from remaining available providers
    FALLBACKS=""
    if [ -n "$MODEL" ]; then
        if [ "$MODEL" != "google/gemini-2.5-flash" ] && [ -n "$GEMINI_API_KEY" ]; then
            FALLBACKS="google/gemini-2.5-flash"
        fi
        if [ "$MODEL" != "anthropic/claude-sonnet-4-5" ] && [ -n "$ANTHROPIC_API_KEY" ]; then
            [ -n "$FALLBACKS" ] && FALLBACKS="$FALLBACKS,anthropic/claude-sonnet-4-5" || FALLBACKS="anthropic/claude-sonnet-4-5"
        fi
        if [ "$MODEL" != "openai/gpt-4o" ] && [ -n "$OPENAI_API_KEY" ]; then
            [ -n "$FALLBACKS" ] && FALLBACKS="$FALLBACKS,openai/gpt-4o" || FALLBACKS="openai/gpt-4o"
        fi
    fi

    if [ -n "$MODEL" ]; then
        echo "[entrypoint] Auto-selected model: $MODEL (fallbacks: ${FALLBACKS:-none})"
        # Use node to do a safe JSON in-place edit (sh has no native JSON support)
        node -e "
            const fs = require('fs');
            const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
            cfg.agents = cfg.agents || {};
            cfg.agents.defaults = cfg.agents.defaults || {};
            cfg.agents.defaults.model = cfg.agents.defaults.model || {};
            cfg.agents.defaults.model.primary = '$MODEL';
            const fb = '$FALLBACKS'.split(',').filter(Boolean);
            if (fb.length) cfg.agents.defaults.model.fallbacks = fb;
            fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2) + '\n');
        "
    else
        echo "[entrypoint] Warning: no model provider API key found (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)."
    fi
fi

# Kill any zombie process holding the OAuth callback port (9753).
# This prevents "Port 9753 already in use" errors after a previous
# OAuth flow timed out or was interrupted.
OAUTH_PORT="${OAUTH_PORT:-9753}"
if command -v fuser >/dev/null 2>&1; then
    fuser -k "${OAUTH_PORT}/tcp" 2>/dev/null && \
        echo "[entrypoint] Killed stale process on port $OAUTH_PORT" || true
elif command -v ss >/dev/null 2>&1; then
    PID=$(ss -tlnp "sport = :$OAUTH_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    [ -n "$PID" ] && kill "$PID" 2>/dev/null && \
        echo "[entrypoint] Killed stale process $PID on port $OAUTH_PORT" || true
fi

# Hand off to the CMD
exec "$@"
