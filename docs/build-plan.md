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
- Categories
- Jobs
- Job views
- Applications
- Messages
- Job progress timeline
- Phone verification records
- Notification records
- Storage buckets later for avatars and job attachments

## Backend Phases

### Phase 1: Foundation

- Create Supabase project.
- Run `supabase/migrations/0001_init_accordia.sql`.
- Run `supabase/seed.sql`.
- Add local `.env.local` from `.env.example`.
- Deploy to Netlify and add the same env vars there.

### Phase 2: Auth and Onboarding

- Use `POST /api/auth/register`.
- Use `POST /api/auth/login`.
- Use `GET /api/profile/me`.
- Use `PATCH /api/profile/me`.
- For professionals, save categories with `PUT /api/professional/categories`.

### Phase 3: Job Marketplace

- Clients create jobs with `POST /api/jobs`.
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
3. Create `.env.local` using `.env.example`.
4. Run the SQL migration in Supabase SQL editor.
5. Run the seed SQL in Supabase SQL editor.
6. Install dependencies with `npm install`.
7. Run locally with `npm run dev`.
8. Connect the Git repo to Netlify.
9. Add env vars in Netlify project settings.
10. Deploy.

## First Product Decisions Already Locked

- General service categories, not one niche.
- Payment happens outside Accordia.
- Professionals only see jobs matching their categories.
- Phone verification is the trust baseline.
- Next.js and TypeScript are the implementation direction.
