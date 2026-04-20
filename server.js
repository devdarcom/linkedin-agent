const http = require('http');
const https = require('https');

const PORT = 3000;

// ─── CORS HEADERS ────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── HTTPS REQUEST HELPER ────────────────────────────────────────────────────
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse body
  let body = '';
  req.on('data', chunk => body += chunk);
  await new Promise(r => req.on('end', r));
  let payload = {};
  try { payload = JSON.parse(body); } catch(e) {}

  const url = req.url;

  console.log(`\n→ ${req.method} ${url}`);

  // ── GET /health ────────────────────────────────────────────────────────────
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'LinkedIn Agent server działa!' }));
    return;
  }

  // ── POST /apify/run ────────────────────────────────────────────────────────
  if (url === '/apify/run' && req.method === 'POST') {
    const { apifyKey, actorId, profileUrls, linkedinCookie } = payload;
    if (!apifyKey || !actorId || !profileUrls) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Brak wymaganych pól: apifyKey, actorId, profileUrls' }));
      return;
    }

    const input = {
      targetUrls: profileUrls,
      maxPosts: 2,
      maxComments: 2,
      maxReactions: 0,
      includeQuotePosts: true,
      includeReposts: true,
      scrapeComments: false,
      scrapeReactions: false,
      postNestedComments: false,
      postNestedReactions: false
    };
    if (linkedinCookie) input.cookie = [{ name: 'li_at', value: linkedinCookie, domain: '.linkedin.com' }];

    const result = await httpsRequest(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${apifyKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      input
    );

    console.log('  Apify response:', result.status, JSON.stringify(result.body).slice(0, 400));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // ── GET /apify/status/:runId ───────────────────────────────────────────────
  if (url.startsWith('/apify/status/') && req.method === 'GET') {
    const parts = url.split('/');
    const runId = parts[3];
    const apifyKey = parts[4];
    if (!runId || !apifyKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Brak runId lub apifyKey' }));
      return;
    }
    const result = await httpsRequest(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`,
      { method: 'GET' }
    );
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // ── GET /apify/dataset/:datasetId ─────────────────────────────────────────
  if (url.startsWith('/apify/dataset/') && req.method === 'GET') {
    const parts = url.split('/');
    const datasetId = parts[3];
    const apifyKey = parts[4];
    const result = await httpsRequest(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=500`,
      { method: 'GET' }
    );
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // ── POST /apify/test ───────────────────────────────────────────────────────
  if (url === '/apify/test' && req.method === 'POST') {
    const { apifyKey } = payload;
    const result = await httpsRequest(
      `https://api.apify.com/v2/users/me?token=${apifyKey}`,
      { method: 'GET' }
    );
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // ── POST /claude ───────────────────────────────────────────────────────────
  if (url === '/claude' && req.method === 'POST') {
    const { anthropicKey, messages, system } = payload;
    if (!anthropicKey || !messages) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Brak anthropicKey lub messages' }));
      return;
    }

    const claudeBody = {
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages
    };
    if (system) claudeBody.system = system;

    const result = await httpsRequest(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        }
      },
      claudeBody
    );

    console.log('  Claude response:', result.status, JSON.stringify(result.body).slice(0, 600));
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Nieznana ścieżka: ' + url }));
}

// ─── START ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch(e) {
    console.error('Błąd serwera:', e.message);
    setCORS(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   LinkedIn Brand Agent — serwer działa ║');
  console.log(`║   http://localhost:${PORT}                 ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('Otwórz linkedin-agent.html w przeglądarce.');
  console.log('Zatrzymaj serwer: Ctrl+C');
  console.log('');
});
