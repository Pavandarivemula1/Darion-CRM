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
      let lastId = 1000;
      let phoneSet = new Set();
      let emailSet = new Set();
      let hasMore = true;
      let from = 0;
      const step = 1000;

      while (hasMore) {
        const { data: leadsBatch, error } = await supabase
          .from('leads')
          .select('Lead ID, Phone, Email')
          .range(from, from + step - 1);

        if (error || !leadsBatch || leadsBatch.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of leadsBatch) {
          try {
            if (row['Phone']) phoneSet.add(row['Phone'].trim());
            if (row['Email']) emailSet.add(row['Email'].trim());

            const idStr = row['Lead ID'] || '';
            const num = parseInt(idStr.split('-')[1]);
            if (!isNaN(num) && num > lastId) {
              lastId = num;
            }
          } catch(e) {}
        }

        if (leadsBatch.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      }

      const validRecords = records;

      const newLeads = validRecords.map(row => {
        lastId++;
        let lead_id = `L-${lastId}`;
        const name = row['business_name'] || row['Name'] || '';
        const phone = row['phone_number'] || row['Phone'] || '';
        const email = row['email'] || row['Email'] || '';
        const location = row['address'] || row['Location'] || '';
        
        let status = 'New';
        if ((phone && phoneSet.has(phone.trim())) || (email && emailSet.has(email.trim()))) {
            status = 'Duplicate';
        }
        if (phone) phoneSet.add(phone.trim());
        if (email) emailSet.add(email.trim());
        const category = row['category'] || row['Category'] || '';
        
        return {
            'Lead ID': lead_id,
            'Name': name.trim(),
            'Phone': phone.trim(),
            'Email': email.trim(),
            'Source': 'Uploaded CSV',
            'Location': location.trim(),
            'Lead Status': status,
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
            'Stage': status,
            'Assigned Salesperson': '',
            'Expected Value': '',
            'Probability (%)': '',
            'Days Since Contact': '',
            'Follow-Up Priority (Auto)': 'Medium',
            'Reminder Flag (Auto)': 'Scheduled'
        };
      });

      // Upsert all at once (inserts new, updates existing)
      if (newLeads.length > 0) {
        const { error } = await supabase.from('leads').upsert(newLeads);
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
