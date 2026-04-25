# Darion CRM | Lead Management System

A custom-built, full-stack Customer Relationship Management (CRM) platform designed specifically for managing leads, tracking pipeline stages, and streamlining follow-up workflows.

## 🚀 Features

- **Dynamic Kanban Pipeline:** Visual board for managing leads across customizable stages (New, Contacted, Cold, etc.).
- **Smart CSV Data Uploads:** Bulk upload leads directly from a CSV file. The system automatically fetches maximum database IDs and safely provisions fresh `L-something` assignments.
- **Intelligent Deduplication:** Prevents database bloating! The upload script intelligently scans both the CSV and the live Supabase database to detect and skip/update duplicates matching by `Phone` or `Email`. 
- **Realtime Database Backend:** Integrated with Supabase PostgreSQL to offer instant, reliable, server-side data preservation.
- **Serverless API Structure:** Optimized API routing via Vercel serverless functions (`/api/*`), ensuring massive scale with zero server-management overhead.
- **Mobile First Focus:** Responsive, flex-based UI design constructed manually using Vanilla CSS (`styles.css`).

## 🛠 Tech Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (`app.js`)
- **Backend API:** Node.js (Vercel Serverless Functions in `/api`)
- **Database:** PostgreSQL (Supabase)
- **Deployment:** Vercel (Front-end + API layer)

## 📁 Project Structure

```text
crm-app/
├── api/
│   ├── leads.js       # API endpoint for fetching leads
│   ├── update.js      # API endpoint for updating existing properties
│   └── upload.js      # API endpoint for processing CSV batch imports with smart-deduplication
├── app.js             # Core Frontend JS logic and Data binding
├── index.html         # Main dashboard layout
├── styles.css         # Styling and mobile responsiveness
├── supabase-schema.sql# PostgreSQL Schema implementation
└── package.json       # Project dependencies (Supabase JS, CSV-Parser)
```

## ⚙️ Local Development

### 1. Install Dependencies
Make sure you have Node mounted safely on your system, then install the package dependencies from the root directory:
```bash
npm install
```

### 2. Environment Variables
You will need to run the back-end using `.env` keys. Create a `.env` file containing your Supabase variables.
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUz...
```

### 3. Run Locally 
You can spin up an instance using the raw python server (`server.py`) for legacy CSV fallback, or use a tool like Vercel CLI to safely emulate the serverless functions locally:
```bash
npm i -g vercel
vercel dev
```

## 📡 Supabase Usage

The CRM relies heavily on Supabase for data management. Ensure the `leads` table matches the architecture defined in `supabase-schema.sql`. The pipeline integrates auto-incrementing custom keys (`L-1xxx`) which are safely calculated server-side inside `api/upload.js`. 

*Built for High-Scale Lead Management.*
