module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { path, payload } = req.body;
  if (!path) {
    return res.status(400).json({ error: 'path is required' });
  }

  const BACKEND_URL = process.env.TEMPLATE_ENGINE_URL || 'https://template-auto-production.up.railway.app';

  try {
    const upstream = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });

    // Check if the response is JSON before parsing
    const contentType = upstream.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await upstream.json();
    } else {
      data = await upstream.text();
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.detail || data || 'Upstream request failed',
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('proxy error:', err);
    return res.status(500).json({ error: String(err) });
  }
};
