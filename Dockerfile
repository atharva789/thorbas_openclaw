# =============================================================
# OpenClaw + Omniclaw — Custom Image
# =============================================================
# Extends the official OpenClaw image with:
#   - Chromium + Xvfb (for web browsing)
#   - TeX Live + poppler (for LaTeX compilation + PDF text extraction)
#   - Omniclaw plugin (Google Workspace + GitHub tools)
#   - Entrypoint that syncs baked-in extensions to mounted volume
# =============================================================

FROM ghcr.io/openclaw/openclaw:latest

# -- Install Chromium + Xvfb for browser automation -----------
# Adds ~300MB but eliminates 60-90s Playwright install per start.
USER root
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xvfb git \
        texlive-latex-base texlive-latex-recommended texlive-fonts-recommended \
        texlive-xetex lmodern pandoc \
        poppler-utils && \
    mkdir -p /home/node/.cache/ms-playwright && \
    PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
        node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
    chown -R node:node /home/node/.cache/ms-playwright && \
    ln -sf /home/node/.cache/ms-playwright/chromium-*/chrome-linux/chrome /usr/bin/chromium && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# -- Install Omniclaw plugin ----------------------------------
# Build into a staging directory (/opt/omniclaw/plugin) so it
# survives volume mounts over ~/.openclaw. The entrypoint copies
# it into the mounted extensions dir on first boot.
USER root
RUN mkdir -p /opt/omniclaw && chown node:node /opt/omniclaw
# Omniclaw postinstall symlinks into ~/.openclaw — create it so npm install succeeds
RUN mkdir -p /home/node/.openclaw && chown node:node /home/node/.openclaw

USER node
RUN git clone --depth 1 https://github.com/mxy680/omniclaw.git \
        /opt/omniclaw/plugin && \
    cd /opt/omniclaw/plugin && \
    npm install --include=dev && \
    npm run build && \
    npm prune --production && \
    rm -rf .git

# -- Entrypoint wrapper + OAuth setup CLI ----------------------
# Copies baked-in extensions to the mounted config volume on boot,
# then starts the OpenClaw Gateway.
# google-oauth-setup.js runs the Google OAuth flow directly from the
# CLI (no agent, no LLM timeout) so port 9753 is never abandoned mid-flow.
USER root
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/google-oauth-setup.js /usr/local/bin/google-oauth-setup.js
RUN chmod +x /usr/local/bin/entrypoint.sh

# -- Runtime ---------------------------------------------------
USER node
ENV NODE_ENV=production

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
