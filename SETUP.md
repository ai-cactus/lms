# Phase 1 Setup Guide: Supabase + Resend

## Step 1: Create Supabase Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click "New Project"
3. Fill in:
   - **Name**: Theraptly LMS
   - **Database Password**: (generate a strong password and save it)
   - **Region**: Choose closest to your users
4. Click "Create new project" (takes ~2 minutes)

## Step 2: Run Database Schema

1. Once your project is ready, go to **SQL Editor** in the left sidebar
2. Click "New Query"
3. Copy the entire contents of `supabase/schema.sql`
4. Paste into the SQL editor
5. Click "Run" (bottom right)
6. Verify success: You should see "Success. No rows returned"

## Step 3: Get Supabase Credentials

1. Go to **Project Settings** (gear icon in sidebar)
2. Click **API** in the left menu
3. Copy these values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (click "Reveal" first)

## Step 4: Configure Storage for Policy Files

1. Go to **Storage** in the left sidebar
2. Click "Create a new bucket"
3. Fill in:
   - **Name**: `policies`
   - **Public bucket**: NO (keep private)
4. Click "Create bucket"
5. Click on the `policies` bucket
6. Go to **Policies** tab
7. Click "New Policy" → "For full customization"
8. Add this policy:

```sql
CREATE POLICY "Admins can upload policies"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'policies' AND
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "Users can view policies in their org"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'policies' AND
  (SELECT organization_id FROM users WHERE id = auth.uid()) IS NOT NULL
);
```

## Step 5: Create Resend Account

1. Go to [https://resend.com](https://resend.com)
2. Sign up for free account
3. Verify your email
4. Go to **API Keys** in dashboard
5. Click "Create API Key"
6. Name it "Theraptly LMS"
7. Copy the key → `RESEND_API_KEY`

## Step 6: Add Domain to Resend (Optional but Recommended)

1. In Resend dashboard, go to **Domains**
2. Click "Add Domain"
3. Enter your domain (e.g., `theraptly.com`)
4. Follow DNS setup instructions
5. Wait for verification (usually 5-10 minutes)

**For testing**: You can skip this and use the default `onboarding@resend.dev` sender

## Step 7: Update Environment Variables

Create or update `.env.local` in your project root:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Resend Email
RESEND_API_KEY=re_your_api_key_here

# Gemini API (existing)
GEMINI_API_KEY=your_existing_gemini_key
```

## Step 8: Restart Development Server

```bash
# Stop the current dev server (Ctrl+C)
npm run dev
```

## Step 9: Create First Admin User (Manual Setup)

Since we don't have a signup flow yet, create your first admin user manually:

1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Click "Add user" → "Create new user"
3. Fill in:
   - **Email**: your email
   - **Password**: create a password
   - **Auto Confirm User**: YES (check this box)
4. Click "Create user"
5. Copy the User ID (UUID)
6. Go to **SQL Editor** and run:

```sql
-- Replace YOUR_USER_ID and YOUR_ORG_NAME
INSERT INTO organizations (id, name, program_type)
VALUES (uuid_generate_v4(), 'YOUR_ORG_NAME', 'Behavioral Health')
RETURNING id;

-- Copy the returned organization ID, then:
INSERT INTO users (id, organization_id, email, full_name, role)
VALUES (
  'YOUR_USER_ID',
  'YOUR_ORG_ID_FROM_ABOVE',
  'your@email.com',
  'Your Full Name',
  'admin'
);
```

## Step 10: Test the Setup

1. Create a simple test API route to verify Supabase connection
2. Try logging in with your admin credentials
3. Verify you can access the database

## Troubleshooting

### "Invalid API key" error
- Double-check you copied the correct keys from Supabase
- Make sure there are no extra spaces in `.env.local`
- Restart your dev server after updating env vars

### "Row Level Security" errors
- Make sure you ran the entire `schema.sql` file
- Check that RLS policies were created (go to Database → Tables → select a table → Policies tab)

### Storage upload fails
- Verify the `policies` bucket exists
- Check that storage policies were created
- Ensure you're logged in as an admin user

### Email not sending
- Verify your Resend API key is correct
- Check Resend dashboard for error logs
- For production, make sure you've verified your domain

## Next Steps

Once setup is complete, we'll move to **Phase 2: Admin Onboarding & Policy Management**

This includes:
- Login/signup pages
- Admin onboarding checklist
- Policy upload interface
- AI course generation
