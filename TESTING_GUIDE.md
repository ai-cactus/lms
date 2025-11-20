# Theraptly LMS - Complete Testing Guide

## Prerequisites Checklist

Before testing, ensure you have completed these setup steps:

### ✅ 1. Supabase Setup
- [ ] Create Supabase project at [supabase.com](https://supabase.com)
- [ ] Run the database schema (`supabase/schema.sql`) in SQL Editor
- [ ] Copy Supabase URL to `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Copy Anon Key to `.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Copy Service Role Key to `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`

### ✅ 2. Environment Variables
- [ ] `GEMINI_API_KEY` - ✅ Already set
- [ ] `RESEND_API_KEY` - ✅ Already set
- [ ] `NEXT_PUBLIC_APP_URL` - Set to `http://localhost:3000`
- [ ] `CRON_SECRET` - ✅ Already set
- [ ] All Supabase variables configured

### ✅ 3. Dependencies
- [ ] Run `npm install` to ensure all packages are installed
- [ ] Verify dev server runs: `npm run dev`

---

## Testing Phases

## Phase 1: Initial Setup & Admin Onboarding

### Test 1.1: First Admin Signup
**Goal**: Create the first admin account and organization

1. **Start the dev server**:
   ```bash
   npm run dev
   ```

2. **Navigate to**: `http://localhost:3000`

3. **Click "Sign Up"**

4. **Fill in the form**:
   - Organization Name: "Test Healthcare Center"
   - Program Type: "Behavioral Health"
   - License Number: "BH-12345"
   - Admin Email: `admin@test.com`
   - Admin Name: "Admin User"
   - Password: `Admin123!`

5. **Expected Result**:
   - ✅ Account created successfully
   - ✅ Redirected to onboarding checklist
   - ✅ Organization created in database

**Verification**:
- Check Supabase → Table Editor → `organizations` (should have 1 row)
- Check Supabase → Table Editor → `users` (should have 1 admin user)

---

### Test 1.2: Admin Onboarding Checklist
**Goal**: Complete the 7-step onboarding process

**Steps to Test**:

1. **Step 1: Organization Setup** - ✅ Already completed during signup

2. **Step 2: Upload First Policy**
   - Click "Upload Policy Document"
   - Upload a PDF file (any PDF for testing)
   - Expected: File uploads to Supabase Storage

3. **Step 3: AI Analysis**
   - Click "Analyze with AI"
   - Expected: Gemini API analyzes document
   - Expected: Shows extracted objectives

4. **Step 4: Review Objectives**
   - Review the AI-generated objectives
   - Edit if needed
   - Click "Approve Objectives"

5. **Step 5: Review Lesson Notes**
   - Review AI-generated lesson content
   - Edit if needed
   - Click "Approve Lesson"

6. **Step 6: Review Quiz**
   - Review AI-generated quiz questions
   - Edit if needed
   - Click "Approve Quiz"

7. **Step 7: Publish Course**
   - Click "Publish Course"
   - Expected: Course saved to database
   - Expected: Redirected to dashboard

**Verification**:
- Check `policies` table (should have 1 policy)
- Check `courses` table (should have 1 course)
- Check `quiz_questions` table (should have quiz questions)

---

## Phase 2: Worker Management

### Test 2.1: Add First Worker
**Goal**: Create a worker account with course assignments

1. **Navigate to**: Dashboard → "Workers" (or `/admin/workers`)

2. **Click**: "Add Worker"

3. **Step 1 - Worker Details**:
   - Full Name: "John Doe"
   - Email: `worker@test.com`
   - Role: "Direct Care Staff"
   - Click "Next"

4. **Step 2 - Course Assignments**:
   - Review auto-suggested CARF courses
   - Select the course you created
   - Set deadline: 7 days from today
   - Click "Create Worker"

5. **Expected Result**:
   - ✅ Worker account created
   - ✅ Temporary password generated
   - ✅ Course assignments created
   - ✅ Email sent (check Resend dashboard)

**Verification**:
- Check `users` table (should have 2 users: 1 admin, 1 worker)
- Check `course_assignments` table (should have assignments)
- Check Resend dashboard for sent email

---

### Test 2.2: View Workers List
**Goal**: Verify worker management interface

1. **Navigate to**: `/admin/workers`

2. **Expected Display**:
   - ✅ Worker card showing "John Doe"
   - ✅ Role: "Direct Care Staff"
   - ✅ Assigned courses count
   - ✅ Status indicators

3. **Test Actions**:
   - Click "View Details" → Should show worker info
   - Click "Deactivate" → Should deactivate worker
   - Click "Reactivate" → Should reactivate worker

---

## Phase 3: Worker Training Flow

### Test 3.1: Worker Login
**Goal**: Worker logs in and sees their dashboard

1. **Logout** from admin account

2. **Navigate to**: `/login`

3. **Login as worker**:
   - Email: `worker@test.com`
   - Password: (temporary password from email or Supabase)

4. **Expected Result**:
   - ✅ Redirected to `/worker/dashboard`
   - ✅ See "Active Trainings" tab
   - ✅ See assigned course with deadline

---

### Test 3.2: Complete Training (3-Step Flow)
**Goal**: Worker completes full training cycle

#### Step 1: Lesson Review

1. **Click**: "Start Training" on assigned course

2. **Expected**:
   - ✅ Redirected to `/worker/training/[assignmentId]`
   - ✅ Progress indicator shows "Step 1 of 3"
   - ✅ Lesson content displayed

3. **Test Scroll Tracking**:
   - Scroll to bottom of lesson content
   - Expected: Progress bar fills to 100%
   - Expected: "Continue to Quiz" button becomes enabled

4. **Click**: "Continue to Quiz"

#### Step 2: Quiz

1. **Expected**:
   - ✅ Progress indicator shows "Step 2 of 3"
   - ✅ Quiz questions displayed
   - ✅ Radio buttons for answers

2. **Answer Questions**:
   - Select answers for all questions
   - Expected: "Submit Quiz" button enabled

3. **Submit Quiz**:
   - Click "Submit Quiz"
   - Expected: Results screen appears

4. **Test Scenarios**:

   **Scenario A: Pass (≥80%)**
   - Expected: Green success message
   - Expected: "Congratulations! You Passed!"
   - Expected: Auto-advance to acknowledgment after 2 seconds

   **Scenario B: Fail (<80%)**
   - Expected: Red failure message
   - Expected: Shows correct answers
   - Expected: "Retake Quiz" button available
   - Expected: "Review Lesson" button available

#### Step 3: Acknowledgment

1. **Expected** (if passed):
   - ✅ Progress indicator shows "Step 3 of 3"
   - ✅ Acknowledgment form displayed
   - ✅ Worker name pre-filled

2. **Fill Form**:
   - Check acknowledgment checkbox
   - Type full name in signature field
   - Click "Submit Training for Supervisor Review"

3. **Expected Result**:
   - ✅ Success message
   - ✅ Redirected to worker dashboard
   - ✅ Course shows "Pending Confirmation" status

**Verification**:
- Check `course_assignments` table (status should be "pending_confirmation")
- Check `course_completions` table (should have 1 completion)
- Check `admin_confirmations` table (should be empty - pending admin review)

---

## Phase 4: Admin Confirmation Workflow

### Test 4.1: View Pending Confirmations
**Goal**: Admin reviews worker completions

1. **Logout** and **login as admin**

2. **Navigate to**: Dashboard

3. **Expected**:
   - ✅ "Pending Confirmations" widget shows 1 pending
   - ✅ Worker name and course visible
   - ✅ Quiz score displayed
   - ✅ Days waiting shown

---

### Test 4.2: Approve Training
**Goal**: Admin approves worker completion

1. **Click**: "Approve" on pending completion

2. **Expected**:
   - ✅ Confirmation dialog appears
   - ✅ Shows worker and course details

3. **Add optional notes** (if desired)

4. **Click**: "Approve"

5. **Expected Result**:
   - ✅ Success message
   - ✅ Completion removed from pending list
   - ✅ Worker can now download certificate

**Verification**:
- Check `course_completions` table (status should be "confirmed")
- Check `admin_confirmations` table (should have 1 confirmation with confirmed=true)

---

### Test 4.3: Deny Training (Trigger Retraining)
**Goal**: Test denial and automatic retraining

1. **Create another worker completion** (repeat Phase 3)

2. **As admin, click**: "Deny"

3. **Fill reason**: "Needs to review section 3 more carefully"

4. **Click**: "Deny & Retrain"

5. **Expected Result**:
   - ✅ Completion status changed to "denied"
   - ✅ Assignment reset to "not_started"
   - ✅ Entry created in `retraining_logs`

**Verification**:
- Check `course_assignments` (status should be "not_started")
- Check `retraining_logs` (should have 1 entry with reason)

---

### Test 4.4: Batch Confirmations
**Goal**: Test bulk approve/deny

1. **Create 3+ worker completions**

2. **Navigate to**: `/admin/confirmations`

3. **Select multiple completions** (checkboxes)

4. **Click**: "Approve Selected"

5. **Expected**:
   - ✅ Batch dialog appears
   - ✅ Shows count of selected items

6. **Confirm batch action**

7. **Expected Result**:
   - ✅ All selected completions approved
   - ✅ Success message with count

---

## Phase 5: Compliance & Reporting

### Test 5.1: Compliance by Role Chart
**Goal**: View compliance visualizations

1. **Navigate to**: Dashboard

2. **Expected**:
   - ✅ "Compliance by Role" chart visible
   - ✅ Pie chart shows role distribution
   - ✅ Role cards show compliance percentages

3. **Click on a role card**:
   - Expected: Drill down into specific role
   - Expected: Shows compliant vs non-compliant breakdown

---

### Test 5.2: Generate Accreditation Report
**Goal**: Export compliance report

1. **Navigate to**: `/admin/reports`

2. **Click**: "Generate Report"

3. **Expected**:
   - ✅ Report generates
   - ✅ Markdown file downloads
   - ✅ Filename includes date

4. **Open downloaded file**:
   - ✅ Contains organization info
   - ✅ Contains executive summary
   - ✅ Contains compliance by role table
   - ✅ Contains course completion rates
   - ✅ Contains recent completions
   - ✅ Contains CARF compliance statement

---

## Phase 6: Email Notifications

### Test 6.1: Worker Welcome Email
**Goal**: Verify welcome email is sent

1. **Create a new worker**

2. **Check Resend Dashboard**:
   - ✅ Email appears in "Emails" tab
   - ✅ Subject: "Welcome to [Org] Training Portal"
   - ✅ Contains temporary password
   - ✅ Contains assigned courses list
   - ✅ Contains login link

---

### Test 6.2: Training Reminder Emails (Manual Test)
**Goal**: Test reminder email generation

1. **Create API test request**:
   ```bash
   curl -X POST http://localhost:3000/api/cron/send-reminders \
     -H "Authorization: Bearer 8KmN9pQr2TvXwYz5BcDfGhJkLmNpQrSt3VwXyZ6AaBbCcDdEeFfGgHhIiJjKkLlMm"
   ```

2. **Expected**:
   - ✅ API returns success response
   - ✅ Shows count of reminders sent

3. **Check Resend Dashboard**:
   - ✅ Reminder emails appear
   - ✅ Subject shows days remaining or "Overdue"
   - ✅ Urgency styling (green/yellow/red)

---

## Phase 7: Certificate Generation

### Test 7.1: Download Certificate
**Goal**: Worker downloads completion certificate

1. **Login as worker** with confirmed completion

2. **Navigate to**: Worker Dashboard → "Completed Trainings" tab

3. **Expected**:
   - ✅ Completed course shows "Confirmed" badge
   - ✅ "Download Certificate" button visible

4. **Click**: "Download Certificate"

5. **Expected**:
   - ✅ PDF downloads
   - ✅ Certificate contains:
     - Worker name
     - Course title
     - Completion date
     - Quiz score
     - Organization name
     - CARF statement
     - Certificate ID

---

## Edge Cases & Error Handling

### Test 8.1: Quiz Retakes
**Goal**: Verify unlimited retakes

1. **Fail quiz intentionally** (score <80%)
2. **Click**: "Retake Quiz"
3. **Expected**: Quiz resets, attempt counter increments
4. **Repeat** multiple times
5. **Expected**: No limit on retakes

---

### Test 8.2: Overdue Assignments
**Goal**: Test overdue status

1. **Create assignment with past deadline**
2. **Expected**:
   - ✅ Shows "Overdue" badge (red)
   - ✅ Appears in overdue count on dashboard
   - ✅ Included in reports

---

### Test 8.3: Worker Deactivation
**Goal**: Deactivated workers can't login

1. **Deactivate a worker**
2. **Try to login as that worker**
3. **Expected**: Login fails or access denied

---

## Performance Testing

### Test 9.1: Large Dataset
**Goal**: Test with realistic data volume

1. **Create**:
   - 50+ workers
   - 10+ courses
   - 100+ assignments

2. **Verify**:
   - ✅ Dashboard loads quickly (<2s)
   - ✅ Charts render correctly
   - ✅ Reports generate successfully
   - ✅ No performance degradation

---

## Security Testing

### Test 10.1: RLS Policies
**Goal**: Verify Row Level Security

1. **As worker, try to access**:
   - `/admin/workers` → Should be blocked
   - `/admin/confirmations` → Should be blocked
   - Another worker's training → Should be blocked

2. **Expected**: All blocked or redirected

---

### Test 10.2: API Security
**Goal**: Test API authentication

1. **Try cron endpoint without auth**:
   ```bash
   curl -X POST http://localhost:3000/api/cron/send-reminders
   ```
   - Expected: 401 Unauthorized

2. **Try with wrong secret**:
   ```bash
   curl -X POST http://localhost:3000/api/cron/send-reminders \
     -H "Authorization: Bearer wrong-secret"
   ```
   - Expected: 401 Unauthorized

---

## Testing Checklist Summary

### Core Functionality
- [ ] Admin signup and onboarding
- [ ] Policy upload and AI analysis
- [ ] Course creation and publishing
- [ ] Worker creation and management
- [ ] Worker login and dashboard
- [ ] Training flow (lesson → quiz → acknowledgment)
- [ ] Scroll-to-end enforcement
- [ ] Quiz scoring and retakes
- [ ] Admin confirmations (approve/deny)
- [ ] Batch confirmations
- [ ] Retraining triggers
- [ ] Certificate generation

### Reporting & Compliance
- [ ] Compliance by role chart
- [ ] Accreditation report generation
- [ ] Overdue tracking
- [ ] Pending confirmations widget

### Email System
- [ ] Worker welcome emails
- [ ] Training reminder emails
- [ ] Cron job execution

### Security
- [ ] RLS policies enforced
- [ ] API authentication working
- [ ] Worker isolation (can't see other workers)

### Edge Cases
- [ ] Quiz retakes (unlimited)
- [ ] Overdue assignments
- [ ] Worker deactivation
- [ ] Large datasets

---

## Known Issues / Limitations

1. **Email Domain**: Using `noreply@theraptly.com` - update for production
2. **Cron Jobs**: Requires Vercel deployment or external cron service
3. **File Upload**: Limited to PDF for policies
4. **Quiz Types**: Only multiple choice currently

---

## Next Steps After Testing

1. **Fix any bugs found during testing**
2. **Write automated tests** (unit, integration, E2E)
3. **Deploy to Vercel**
4. **Set up production Supabase**
5. **Configure custom domain for emails**
6. **Set up monitoring and logging**

---

## Support

If you encounter issues:
1. Check browser console for errors
2. Check terminal/server logs
3. Verify environment variables
4. Check Supabase logs
5. Review this testing guide

Good luck with testing! 🚀
