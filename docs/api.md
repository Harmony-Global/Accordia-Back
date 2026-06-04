# Accordia API Draft

All protected routes expect:

```http
Authorization: Bearer <supabase-access-token>
```

## Auth

- `POST /api/auth/register`
- `POST /api/auth/login`

## Profile

- `GET /api/profile/me`
- `PATCH /api/profile/me`
- `GET /api/categories`
- `PUT /api/professional/categories`

## Jobs

- `GET /api/jobs`
- `POST /api/jobs`
- `GET /api/jobs/feed`
- `GET /api/jobs/:jobId`
- `PATCH /api/jobs/:jobId`
- `POST /api/jobs/:jobId/apply`
- `GET /api/jobs/:jobId/applications`

## Applications

- `POST /api/applications/:applicationId/award`

## Messages

- `GET /api/messages`
- `POST /api/messages`

## Progress

- `GET /api/jobs/:jobId/progress`
- `POST /api/jobs/:jobId/progress`

## Admin

- `GET /api/admin/verifications`
- `PATCH /api/admin/verifications/:verificationId`
