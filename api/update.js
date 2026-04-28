const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const updated_lead = req.body;
    
    // Process the update based on Lead ID
    const { data, error } = await supabase
      .from('leads')
      .update(updated_lead)
      .eq('"Lead ID"', updated_lead['Lead ID']);
      
    if (error) {
      console.error("Supabase Update Error:", error);
      return res.status(500).json({ error: error.message, details: error.details, code: error.code });
    }
    return res.status(200).json({ status: 'success' });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
