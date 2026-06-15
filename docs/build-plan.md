# Accordia Backend Build Plan

Accordia is a lightweight two-sided job platform for general services. Clients post work, professionals see only jobs matching their selected categories, payments happen outside the platform, and trust starts with phone verification.

## Architecture

- Next.js with TypeScript runs the web app and backend API routes.
- Netlify deploys the Next.js app and server routes.
- Supabase owns Auth, Postgres, Row Level Security, and Storage.
- Email/SMS providers will be attached later for notifications and phone OTP.
- Admin tools live inside the same app under protected admin routes.

## What Goes Where

Netlify:

- Next.js app
- API route handlers under `app/api`
- Server-only Supabase service role usage
- Environment variables

Supabase:

- Auth users
- Profiles and professional profiles
- Professional services and products with profile images and price ranges
- Categories
- Jobs
- Job views
- Applications
- Messages
- Job progress timeline
- Phone verification records
- Notification records
- Storage for professional offering images; avatar and job attachment buckets can follow the same pattern.

## Backend Phases

### Phase 1: Foundation

- Create Supabase project.
- Run `supabase/migrations/0001_init_accordia.sql`.
- Run `supabase/migrations/0002_security_workflow_otp.sql`.
- Run `supabase/seed.sql`.
- Add local `.env` from `.env.example`.
- Deploy to Netlify and add the same env vars there.

### Phase 2: Auth and Onboarding

- Use `POST /api/auth/register`.
- Use `POST /api/auth/login`.
- Use `GET /api/profile/me`.
- Use `PATCH /api/profile/me`.
- For professionals, save categories with `PUT /api/professional/categories`.
- Professionals add at least five active services/products through `/api/professional/services` to complete their offering portfolio.

### Phase 3: Job Marketplace

- Clients create jobs with `POST /api/jobs`.
- Client job posts describe the work without publishing a budget range.
- Professionals load matched jobs with `GET /api/jobs/feed`.
- Professionals view job details with `GET /api/jobs/:jobId`, which records one view per professional.
- Professionals apply with `POST /api/jobs/:jobId/apply`.
- Clients view applicants with `GET /api/jobs/:jobId/applications`.
- Clients award work with `POST /api/applications/:applicationId/award`.

### Phase 4: Work Tracking

- Users load a job timeline with `GET /api/jobs/:jobId/progress`.
- Job participants add updates with `POST /api/jobs/:jobId/progress`.
- The current job status updates when a progress entry is added.

### Phase 5: Admin and Trust

- Admins review verification rows through `/api/admin/verifications`.
- Phone OTP provider gets added after the workflow is proven.
- Admin dashboard expands to users, jobs, flagged content, and basic platform metrics.

## Setup Checklist

1. Create a Supabase project.
2. Copy the project URL, anon key, and service role key.
3. Create `.env` using `.env.example`.
4. Run the SQL migration in Supabase SQL editor.
5. Run the security/workflow migration in Supabase SQL editor.
6. Run the seed SQL in Supabase SQL editor.
7. Install dependencies with `npm install`.
8. Run locally with `npm run dev`.
9. Connect the Git repo to Netlify.
10. Add env vars in Netlify project settings.
11. Deploy.

## Admin Bootstrap

Create the first admin after registering a normal account:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

Run this directly in the Supabase SQL editor. After the first admin exists, admin API routes can manage verification queues, users, and categories.

## Manual Backend Verification

Until a test framework is added, verify these flows after applying migrations:

1. Register client and professional users.
2. Confirm inactive profiles cannot log in or access protected routes.
3. Confirm direct profile updates cannot change `role`, `phone_verified`, or `is_active`.
4. Start and confirm phone verification; confirm wrong and expired OTPs fail.
5. Change phone through `PATCH /api/profile/me`; confirm `phone_verified` resets.
6. Set professional categories and confirm only open matching jobs appear in `/api/jobs/feed`.
7. Submit multiple applications to one open job, award one application, and confirm competing applications become rejected and receive notifications.
8. Confirm an awarded job disappears from professional feeds and rejects new applications.
9. Confirm invalid progress transitions are rejected.
10. Confirm only valid job participants can send messages for a job.
11. Confirm notification read updates cannot change notification content.

## First Product Decisions Already Locked

- General service categories, not one niche.
- Payment happens outside Accordia.
- Professionals only see jobs matching their categories.
- Phone verification is the trust baseline.
- Next.js and TypeScript are the implementation direction.
