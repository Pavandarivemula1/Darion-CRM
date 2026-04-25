const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse/sync');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // Vercel serverless buffer reading for file upload payload
      let chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawCsv = Buffer.concat(chunks).toString('utf8');

      const records = parse(rawCsv, {
        columns: true,
        skip_empty_lines: true
      });

      // Get last ID to increment sequentially
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('Lead ID')
        .order('Lead ID', { ascending: false })
        .limit(1);

      let lastId = 1000;
      if (existingLeads && existingLeads.length > 0) {
        try {
          const idStr = existingLeads[0]['Lead ID'];
          lastId = parseInt(idStr.split('-')[1]) || 1000;
        } catch(e){}
      }

      const newLeads = records.map(row => {
        lastId++;
        const lead_id = `L-${lastId}`;
        const name = row['business_name'] || row['Name'] || '';
        const phone = row['phone_number'] || row['Phone'] || '';
        const email = row['email'] || row['Email'] || '';
        const location = row['address'] || row['Location'] || '';
        const category = row['category'] || row['Category'] || '';
        
        return {
            'Lead ID': lead_id,
            'Name': name.trim(),
            'Phone': phone.trim(),
            'Email': email.trim(),
            'Source': 'Uploaded CSV',
            'Location': location.trim(),
            'Lead Status': 'New',
            'Combined Score': '',
            'Category (Pitch Angle)': category.trim(),
            'Website': row['website'] || '',
            'Has WhatsApp': row['has_whatsapp'] || '',
            'Is Website Poor': row['is_website_poor'] || '',
            'Budget': '',
            'Requirement Type': '',
            'Urgency Level': '',
            'Last Contacted Date': '',
            'Next Follow-Up Date': '',
            'Follow-Up Count': '0',
            'Follow-Up Notes': '',
            'Preferred Contact': phone ? 'Phone' : 'Email',
            'Stage': 'New',
            'Assigned Salesperson': '',
            'Expected Value': '',
            'Probability (%)': '',
            'Days Since Contact': '',
            'Follow-Up Priority (Auto)': 'Medium',
            'Reminder Flag (Auto)': 'Scheduled'
        };
      });

      // Insert all at once
      if (newLeads.length > 0) {
        const { error } = await supabase.from('leads').insert(newLeads);
        if (error) throw error;
      }

      return res.status(200).json({ status: 'success', added: newLeads.length });

    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
