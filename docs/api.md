# Accordia API

All protected routes expect:

```http
Authorization: Bearer <supabase-access-token>
```

Errors use:

```json
{ "error": "Message", "details": {} }
```

## Auth

- `POST /api/auth/register`
  - Body: `{ "email", "password", "phone", "role": "client" | "professional", "first_name", "last_name" }`
  - Creates Supabase Auth user, profile, and professional profile when needed.
- `POST /api/auth/login`
  - Body: `{ "email", "password" }`
  - Rejects inactive profiles.

## Profile and Onboarding

- `GET /api/profile/me`
  - Returns the current profile, professional profile, and selected professional categories.
- `PATCH /api/profile/me`
  - Body: `{ "profile": { "first_name"?, "last_name"?, "phone"?, "avatar_url"? }, "professional_profile": { ... } }`
  - Phone changes reset `phone_verified`.
- `GET /api/categories`
  - Returns active categories.
- `GET /api/professional/categories`
  - Returns the current professional's selected categories.
- `PUT /api/professional/categories`
  - Body: `{ "category_ids": ["uuid"] }`
  - Replaces selected categories.

## Phone Verification

- `POST /api/verifications/phone/start`
  - Body: `{ "phone"? }`
  - Creates or refreshes a pending phone OTP verification.
  - Non-production responses include `dev_code` for local testing.
- `POST /api/verifications/phone/confirm`
  - Body: `{ "code": "123456" }`
  - Confirms active OTP and sets `phone_verified = true`.
- `GET /api/verifications/me`
  - Returns the current user's verification records without OTP hashes.

## Jobs

- `GET /api/jobs`
  - Query: `status?`, `mine=true?`
  - Returns RLS-visible jobs. `mine=true` filters to the caller's client jobs.
- `POST /api/jobs`
  - Client only. Creates a job and initial progress entry.
- `GET /api/jobs/feed`
  - Professional only. Returns open jobs matching selected categories while the professional is available.
- `GET /api/jobs/:jobId`
  - Returns job detail. Professional views are recorded once when visible.
- `PATCH /api/jobs/:jobId`
  - Client/admin only. Updates editable job fields, not workflow status.
- `POST /api/jobs/:jobId/apply`
  - Professional only. Creates an application, first message, notification, and discussion progress entry.
- `GET /api/jobs/:jobId/applications`
  - Client/admin only. Lists applicants for the job.

## Applications

- `GET /api/applications/me`
  - Professional only. Lists the caller's applications with job context.
- `POST /api/applications/:applicationId/award`
  - Client only. Awards a pending/reviewed/shortlisted application when the job is still awardable.

## Messages

- `GET /api/messages`
  - Query: `job_id?`
  - Returns messages for the caller with sender, receiver, job, and application context.
- `POST /api/messages`
  - Body: `{ "receiver_id", "job_id", "application_id"?, "body" }`
  - Sender and receiver must be valid job participants.
- `PATCH /api/messages/read`
  - Body: `{ "job_id", "sender_id"? }`
  - Marks matching messages received by the caller as read.

## Progress

- `GET /api/jobs/:jobId/progress`
  - Returns the timeline visible to actual job participants.
- `POST /api/jobs/:jobId/progress`
  - Body: `{ "status": "in_progress" | "in_review" | "delivered" | "closed" | "cancelled", "note"? }`
  - Enforces allowed transitions.

## Notifications

- `GET /api/notifications`
  - Query: `unread=true?`
  - Lists the caller's notifications.
- `PATCH /api/notifications/:notificationId/read`
  - Body: `{ "is_read": true | false }`
  - Updates only read state.

## Admin

- `GET /api/admin/verifications`
  - Query: `status?`, `type?`, `role?`, `limit?`, `offset?`
- `PATCH /api/admin/verifications/:verificationId`
  - Body: `{ "status": "verified" | "rejected" }`
- `GET /api/admin/users`
  - Query: `role?`, `is_active?`, `limit?`, `offset?`
- `PATCH /api/admin/users/:userId/status`
  - Body: `{ "is_active": true | false }`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PATCH /api/admin/categories/:categoryId`
