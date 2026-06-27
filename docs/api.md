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
- `POST /api/auth/oauth/profile`
  - Authorization: `Bearer <supabase-access-token>` from Google OAuth.
  - Body for new Google users: `{ "role": "client" | "professional", "phone", "first_name"?, "last_name"? }`
  - Creates the missing Accordia profile after Supabase Google sign-in, or returns the existing profile.
- `POST /api/auth/oauth/google`
  - Body: `{ "redirect_to" }`
  - Returns a Supabase Google OAuth URL for the frontend to navigate to.
- `POST /api/auth/password/forgot`
  - Body: `{ "email", "redirect_to"? }`
  - Sends a Supabase reset email only for active users with an existing password record.
- `POST /api/auth/password/reset`
  - Authorization: `Bearer <supabase-access-token>` from the password recovery session.
  - Body: `{ "password" }`
  - Updates the password and records the password log event.

## Profile and Onboarding

- `GET /api/profile/me`
  - Returns the current profile, professional profile, selected professional categories, and professional services/products.
  - Professional responses include `professional_services_progress` for the five-active-offering onboarding target.
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
- `GET /api/professional/services`
  - Professional: returns the caller's services/products, including inactive entries.
  - Client/admin: pass `professional_id=<profile-uuid>` to view a professional's active entries.
  - Returns `service_count`, `minimum_required: 5`, and `has_minimum_services`.
- `POST /api/professional/services`
  - Professional only.
  - Body: `{ "category_id"?, "offering_type": "service" | "product", "title", "description", "image_url", "price_min", "price_max", "currency"?, "is_active"? }`
  - A supplied category must already be selected on the professional's profile.
- `POST /api/professional/services/upload`
  - Professional only. Multipart form body with a `file` field.
  - Accepts JPEG, PNG, or WebP images up to 5 MB and returns the public `image_url`.
- `PATCH /api/professional/services/:serviceId`
  - Professional only. Updates an owned service/product.
- `DELETE /api/professional/services/:serviceId`
  - Professional only. Deletes an owned service/product.

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
  - Client only.
  - Body: `{ "category_id", "title", "description", "location"?, "state"?, "is_remote"?, "start_date"?, "end_date"? }`
  - Client job payloads do not include budget or price-range fields.
  - Creates a job and initial progress entry.
- `GET /api/jobs/feed`
  - Professional only. Returns open jobs matching selected categories while the professional is available.
- `GET /api/jobs/:jobId`
  - Returns job detail. Professional views are recorded once when visible.
- `PATCH /api/jobs/:jobId`
  - Client/admin only. Updates editable job fields, not workflow status.
- `POST /api/jobs/:jobId/apply`
  - Professional only. Creates an application, first message, notification, and discussion progress entry.
  - The job remains open for other offers until the client awards an application.
- `GET /api/jobs/:jobId/applications`
  - Client/admin only. Lists applicants with their profile, categories, and services/products.

## Applications

- `GET /api/applications/me`
  - Professional only. Lists the caller's applications with job context.
- `POST /api/applications/:applicationId/award`
  - Client only. Marks a pending/reviewed/shortlisted application as `selected`.
  - Returns `{ "application": { ... } }`.
- `POST /api/applications/:applicationId/undo-award`
  - Client only. Restores a `selected` application to its previous reviewable status before awards are sealed.
  - Returns `{ "application": { ... } }`.
- `POST /api/jobs/:jobId/awards/seal`
  - Client only. Finalizes all selected applications for the job.
  - Selected applications become `awarded`; remaining reviewable applications become `not_awarded`.
  - Creates award/not-awarded notifications, writes audit logs, removes the job from professional feeds, and blocks new applications.

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
