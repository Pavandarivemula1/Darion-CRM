/**
 * Local dev server for Darion CRM
 * Serves static files AND mounts /api handlers just like Vercel does.
 * Usage: node server.js   (or: npm run dev)
 */
require('dotenv').config({ path: '.env.local' });
// Load SUPABASE_URL / SUPABASE_ANON_KEY from a .env file if present
require('dotenv').config();

const express  = require('express');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3030;

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/csv', limit: '20mb' }));

// ── Proxy: forward browser requests to Railway backend (avoids CORS) ─
const RAILWAY_URL = 'https://template-auto-production.up.railway.app';

app.post('/api/proxy-backend', async (req, res) => {
    const { path, payload } = req.body;
    if (!path) return res.status(400).json({ error: 'Missing path' });
    try {
        const upstream = await fetch(`${RAILWAY_URL}${path}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload || {})
        });
        const data = await upstream.json().catch(() => ({}));
        res.status(upstream.status).json(data);
    } catch (err) {
        console.error('[proxy-backend]', err.message);
        res.status(502).json({ error: 'Upstream request failed', detail: err.message });
    }
});

// ── Mount each Vercel serverless handler as an Express route ──
function wrapHandler(handlerFn) {
    return (req, res) => handlerFn(req, res);
}

app.all('/api/leads',   wrapHandler(require('./api/leads')));
app.all('/api/update',  wrapHandler(require('./api/update')));
app.all('/api/delete',  wrapHandler(require('./api/delete')));
app.all('/api/upload',  wrapHandler(require('./api/upload')));
app.all('/api/deploy',  wrapHandler(require('./api/deploy')));

// ── Static files (HTML, CSS, JS, etc.) ───────────────────────
app.use(express.static(path.join(__dirname)));

// ── Fallback: serve index.html for any unmatched GET ─────────
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n✅ Darion CRM running at http://localhost:${PORT}\n`);
});
