const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const new_lead = req.body;
    
    // Insert new lead
    const { data, error } = await supabase
      .from('leads')
      .insert([new_lead]);
      
    if (error) {
      console.error("Supabase Insert Error:", error);
      return res.status(500).json({ error: error.message, details: error.details, code: error.code });
    }
    
    return res.status(200).json({ status: 'success', data });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
