/**
 * api/deploy.js
 * Serverless proxy: receives { client_id } from the browser,
 * calls the local template engine /deploy/{id} endpoint,
 * and returns the Vercel public URL.
 *
 * This keeps the VERCEL_TOKEN server-side only.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  const TEMPLATE_ENGINE_URL =
    process.env.TEMPLATE_ENGINE_URL || 'http://localhost:8000';

  try {
    const upstream = await fetch(`${TEMPLATE_ENGINE_URL}/deploy/${client_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.detail || 'Deployment failed',
      });
    }

    return res.status(200).json(data);   // { url, deployment_id }
  } catch (err) {
    console.error('deploy proxy error:', err);
    return res.status(500).json({ error: String(err) });
  }
};
