const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No IDs provided' });
      }

      // Supabase .delete().in() removes multiple records by ID 
      const { data, error } = await supabase
        .from('leads')
        .delete()
        .in('"Lead ID"', ids);

      if (error) throw error;

      return res.status(200).json({ status: 'success', deleted: ids.length });

    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e), details: e.details, code: e.code });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
