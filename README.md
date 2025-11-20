# Theraptly - AI-Powered LMS for Behavioral Health

An intelligent Learning Management System designed specifically for behavioral health organizations to manage CARF-compliant training programs.

## Features

- **AI Course Generation**: Automatically create training courses from policy documents using Google Gemini
- **CARF Compliance**: Pre-configured course templates for all CARF standards across multiple program types
- **Worker Management**: Assign, track, and manage training for staff members
- **Progressive Quizzes**: Interactive assessments with configurable passing scores and retry limits
- **Email Notifications**: Automated reminders and welcome emails using Resend
- **Admin Dashboard**: Comprehensive analytics and oversight of training programs
- **Certificate Generation**: Automatic PDF certificate creation upon course completion

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL with RLS)
- **Authentication**: Supabase Auth
- **AI**: Google Gemini API
- **Email**: Resend
- **Styling**: Tailwind CSS
- **Charts**: Chart.js
- **PDF Generation**: jsPDF

## Setup

### Prerequisites

- Node.js 18+ installed
- A Supabase account ([supabase.com](https://supabase.com))
- A Google AI Studio account ([aistudio.google.com](https://aistudio.google.com))
- A Resend account ([resend.com](https://resend.com)) - Optional, for email features

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd lms
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

   Fill in your credentials:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   RESEND_API_KEY=your_resend_api_key_here
   RESEND_FROM_EMAIL=noreply@yourdomain.com
   ```

4. **Set up the database**

   - Open your Supabase project dashboard
   - Go to **SQL Editor**
   - Copy and paste the contents of `supabase/COMPLETE_SETUP.sql`
   - Run the script
   - This will create all tables, functions, RLS policies, and triggers

5. **Run the development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### First-Time Setup

1. Navigate to `/signup`
2. Create your organization account (you'll be the admin)
3. Verify your email
4. Log in and start adding workers and creating courses!

### Creating Courses

1. Click "Create Course" from the dashboard
2. Select your program type and category
3. Upload policy documents (PDF, DOCX, TXT)
4. Review and customize the AI-generated course content
5. Configure quiz settings
6. Publish!

### Managing Workers

1. Go to "Workers" from the sidebar
2. Click "Add Worker"
3. Enter their details and select required CARF courses
4. They'll receive a welcome email with signup instructions

## Project Structure

```
lms/
├── src/
│   ├── app/              # Next.js app routes
│   │   ├── admin/        # Admin dashboard pages
│   │   ├── worker/       # Worker dashboard pages
│   │   ├── api/          # API routes
│   │   └── auth/         # Authentication pages
│   ├── components/       # React components
│   ├── lib/              # Utility functions
│   │   ├── supabase/     # Supabase client & middleware
│   │   ├── gemini.ts     # AI integration
│   │   └── email.ts      # Email templates
│   └── types/            # TypeScript definitions
├── supabase/
│   └── COMPLETE_SETUP.sql # Database schema
└── public/               # Static assets
```

## Key Features Explained

### Role-Based Access Control (RLS)

- **Admins** can manage their organization's workers, courses, and view analytics
- **Workers** can only view and complete their assigned training
- All enforced at the database level via Supabase RLS policies

### AI Course Generation

Powered by Google Gemini 1.5 Flash, the system:
1. Extracts text from uploaded documents
2. Generates structured lesson content with learning objectives
3. Creates contextual quiz questions
4. Maps content to relevant CARF standards

### Compliance Tracking

- Pre-loaded with CARF 2025 course requirements for:
  - Behavioral Health
  - Child & Family Services
  - Opioid Treatment Programs
  - Substance Abuse Treatment
- Automatic tracking of course completion status
- Deadline management with overdue indicators

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the project in Vercel
3. Add your environment variables
4. Deploy!

### Environment Variables in Production

Make sure to set all variables from `.env.example` in your hosting platform's environment settings.

## Troubleshooting

### "Database error saving new user"
- Ensure `supabase/COMPLETE_SETUP.sql` was run successfully
- Check Supabase logs for detailed error messages
- Verify all ENUMs and tables exist in your database

### "Invalid Supabase URL"
- Double-check `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`
- Ensure there are no trailing slashes
- Restart your dev server after changing env variables

### Email confirmation not working
- Verify your Supabase project has email confirmation enabled
- Check that the auth callback route exists (`/auth/callback`)
- Ensure your Supabase redirect URL is set correctly

## License

MIT

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## Support

For issues or questions, please open a GitHub issue.
