const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

// Bulk-update Lead Status for a list of Lead IDs in a single Supabase call.
// Body: { leadIds: string[], fields: { 'Lead Status': string, ... } }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { leadIds, fields } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !fields) {
    return res.status(400).json({ error: 'leadIds (array) and fields (object) are required.' });
  }

  const { data, error } = await supabase
    .from('leads')
    .update(fields)
    .in('Lead ID', leadIds);

  if (error) {
    console.error('Supabase bulk-update error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ status: 'success', updated: leadIds.length });
};
