# =============================================================
# OpenClaw + Omniclaw — Custom Image
# =============================================================
# Extends the official OpenClaw image with:
#   - Chromium + Xvfb (for autonomous headless web browsing)
#   - TeX Live + poppler (for LaTeX compilation + PDF text extraction)
#   - Omniclaw plugin (Google Workspace + GitHub tools)
#   - Entrypoint that syncs baked-in extensions to mounted volume
#
# Browser runs fully headless via Playwright — no Chrome
# extension or relay needed. The agent uses the built-in
# browser tool directly.
# =============================================================

FROM ghcr.io/openclaw/openclaw:latest

# -- Install Chromium + Xvfb for browser automation -----------
# Adds ~300MB but eliminates 60-90s Playwright install per start.
# Also installs fonts for proper page rendering in headless mode.
USER root
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xvfb git \
        texlive-latex-base texlive-latex-recommended texlive-fonts-recommended \
        texlive-xetex lmodern pandoc \
        poppler-utils \
        fonts-liberation fonts-noto-color-emoji fonts-noto-cjk && \
    mkdir -p /home/node/.cache/ms-playwright && \
    PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
        node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
    chown -R node:node /home/node/.cache/ms-playwright && \
    ln -sf /home/node/.cache/ms-playwright/chromium-*/chrome-linux/chrome /usr/bin/chromium && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# -- Install Omniclaw plugin (pre-built, copied from repo) ----
# Avoids running npm install + tsc inside Docker (OOMs on 4GB VPS).
# Build locally with: cd local-config/extensions/omniclaw && npm install && npx tsc
USER root
RUN mkdir -p /opt/omniclaw/plugin && \
    mkdir -p /home/node/.openclaw && \
    chown -R node:node /opt/omniclaw /home/node/.openclaw

COPY --chown=node:node local-config/extensions/omniclaw/dist/      /opt/omniclaw/plugin/dist/
COPY --chown=node:node local-config/extensions/omniclaw/node_modules/ /opt/omniclaw/plugin/node_modules/
COPY --chown=node:node local-config/extensions/omniclaw/package.json  /opt/omniclaw/plugin/package.json

# -- Entrypoint wrapper + OAuth setup CLI ----------------------
USER root
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/google-oauth-setup.js /usr/local/bin/google-oauth-setup.js
RUN chmod +x /usr/local/bin/entrypoint.sh

# -- Runtime ---------------------------------------------------
USER node
ENV NODE_ENV=production

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
