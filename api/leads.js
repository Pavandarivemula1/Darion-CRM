const { createClient } = require('@supabase/supabase-js');

// Create Supabase client from Environment Variables
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
     const { data, error } = await supabase
       .from('leads')
       .select('*')
       .order('Lead ID', { ascending: true })
       .limit(999999);
       
     if (error) {
       console.error("Supabase Error:", error);
       return res.status(500).json({ error: error.message });
     }
     
     return res.status(200).json(data || []);
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
