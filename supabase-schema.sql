CREATE TABLE IF NOT EXISTS public.leads (
  "Lead ID" text PRIMARY KEY,
  "Name" text,
  "Phone" text,
  "Email" text,
  "Source" text,
  "Location" text,
  "Lead Status" text,
  "Combined Score" text,
  "Category (Pitch Angle)" text,
  "Website" text,
  "Has WhatsApp" text,
  "Is Website Poor" text,
  "Budget" text,
  "Requirement Type" text,
  "Urgency Level" text,
  "Last Contacted Date" text,
  "Next Follow-Up Date" text,
  "Follow-Up Count" text,
  "Follow-Up Notes" text,
  "Preferred Contact" text,
  "Stage" text,
  "Assigned Salesperson" text,
  "Expected Value" text,
  "Probability (%)" text,
  "Days Since Contact" text,
  "Follow-Up Priority (Auto)" text,
  "Reminder Flag (Auto)" text
);

-- Note: Because we are connecting from a serverless backend environment variable,
-- you can just use your SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
-- If you use the SUPABASE_ANON_KEY instead, you should ensure RLS is either disabled 
-- for public or you have public permissions configured for inserts and selects.
