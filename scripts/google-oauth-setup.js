#!/usr/bin/env node
/**
 * google-oauth-setup.js
 *
 * Standalone Google OAuth2 setup script for Omniclaw.
 * Runs outside the agent loop so there is no LLM timeout to race against.
 *
 * Usage (from the host):
 *   docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
 *
 * If port 9753 is already bound from a previous failed attempt, restart
 * the container first:
 *   docker compose restart openclaw-gateway
 *   docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const { URL } = require('url');

// ── Config (mirrors openclaw.json plugin config) ────────────────────────────
const CLIENT_SECRET_PATH =
  process.env.OMNICLAW_CLIENT_SECRET_PATH ||
  '/home/node/.openclaw/client_secret.json';

const TOKENS_PATH =
  process.env.OMNICLAW_TOKENS_PATH ||
  '/home/node/.openclaw/omniclaw-tokens.json';

const OAUTH_PORT = parseInt(process.env.OAUTH_PORT || '9753', 10);
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth/callback`;

// Google API scopes that match the services listed in agents.json
const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/youtube.readonly',
  'openid',
  'email',
  'profile',
];

// ── Load googleapis from omniclaw's node_modules ────────────────────────────
let google;
try {
  ({ google } = require('/opt/omniclaw/plugin/node_modules/googleapis'));
} catch (e) {
  console.error('ERROR: Could not load googleapis from omniclaw plugin.');
  console.error('  Expected path: /opt/omniclaw/plugin/node_modules/googleapis');
  console.error('  Details:', e.message);
  console.error('\nMake sure you are running this inside the openclaw-gateway container:');
  console.error('  docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js');
  process.exit(1);
}

// ── Load and validate client_secret.json ────────────────────────────────────
if (!fs.existsSync(CLIENT_SECRET_PATH)) {
  console.error(`ERROR: client_secret.json not found at: ${CLIENT_SECRET_PATH}`);
  console.error('\nCopy your Google OAuth credentials into the config volume:');
  console.error('  # macOS (local-config/ is mounted to /home/node/.openclaw):');
  console.error('  cp /path/to/client_secret.json local-config/');
  console.error('  # VPS:');
  console.error('  scp client_secret.json user@<vps-ip>:/opt/openclaw/config/');
  process.exit(1);
}

let clientId, clientSecret;
try {
  const raw = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  // Google issues either "web" or "installed" application credentials
  const creds = raw.web || raw.installed;
  if (!creds) throw new Error('Unexpected client_secret.json format — no "web" or "installed" key');
  clientId = creds.client_id;
  clientSecret = creds.client_secret;
  if (!clientId || !clientSecret) throw new Error('Missing client_id or client_secret');
} catch (e) {
  console.error('ERROR: Failed to parse client_secret.json:', e.message);
  process.exit(1);
}

// ── Build OAuth2 client and auth URL ────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // always re-issue refresh_token
});

// ── Start the callback server ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let reqUrl;
  try {
    reqUrl = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (reqUrl.pathname !== '/oauth/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error) {
    const msg = `OAuth error: ${error}`;
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>OAuth Error</h1><p>${error}</p><p>You can close this tab and re-run the script.</p>`);
    console.error('\n' + msg);
    server.close(() => process.exit(1));
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Missing code parameter</h1>');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    // Persist tokens — same path omniclaw reads at startup
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:2em">
        <h1>&#x2713; Google OAuth complete!</h1>
        <p>Tokens saved to <code>${TOKENS_PATH}</code></p>
        <p>You can close this browser tab.</p>
      </body></html>
    `);

    console.log('\n\u2713 Success! Tokens saved to:', TOKENS_PATH);
    if (tokens.refresh_token) {
      console.log('  refresh_token present — long-lived access granted.');
    } else {
      console.log('  WARNING: no refresh_token returned.');
      console.log('  Go to https://myaccount.google.com/permissions, revoke this app, and re-run.');
    }
    console.log('\nOmniclaw is now authorized. Gmail, Calendar, Drive, etc. are ready.');

    server.close(() => process.exit(0));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>Token exchange failed</h1><p>${err.message}</p>`);
    console.error('\nFailed to exchange code for tokens:', err.message);
    server.close(() => process.exit(1));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${OAUTH_PORT} is already in use.`);
    console.error('A previous OAuth attempt may have left the port bound.');
    console.error('Restart the container to clear it, then re-run:');
    console.error('  docker compose restart openclaw-gateway');
    console.error('  docker compose exec -it openclaw-gateway node /usr/local/bin/google-oauth-setup.js');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(OAUTH_PORT, '0.0.0.0', () => {
  console.log('='.repeat(62));
  console.log('  Google OAuth Setup for Omniclaw');
  console.log('='.repeat(62));
  console.log('');
  console.log('1. Open this URL in your browser:');
  console.log('');
  console.log('  ', authUrl);
  console.log('');
  console.log('2. Sign in with your Google account and grant access.');
  console.log('');
  console.log(`Waiting for callback on port ${OAUTH_PORT} — no timeout.`);
  console.log('');
});
