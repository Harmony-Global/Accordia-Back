# Accordia UI/UX Design Direction

Accordia is a lightweight Nigerian-first jobs marketplace for two roles only: clients and professionals. The MVP should feel practical, trusted, and fast. It should avoid marketplace bloat, public social features, payment complexity, and heavy verification flows.

## Product Principles

- Phone-first trust: make phone verification visible and central. Treat BVN/NIN as optional/admin-reviewed trust depth, not the main MVP journey.
- Role clarity: clients post and manage work; professionals select categories, receive matched jobs, apply, message, and update progress.
- Category matching: professionals should not browse a generic marketplace first. Their home state is a matched feed based on selected categories.
- Async by design: messages and updates are calm, threaded, and timestamped. Do not imply real-time chat infrastructure.
- Off-platform payment: use neutral language like "Agree terms" and "Award job"; do not design escrow, wallet, payout, or payment screens for MVP.
- Operational dashboards over marketing: after sign-in, every screen should prioritize next actions, status, and scannable data.

## Information Architecture

Public/Auth:
- Landing with login/register
- Role choice during registration
- Phone OTP verification

Client:
- Dashboard
- Post job
- Job detail
- Applicants
- Award confirmation
- Messages
- Progress timeline

Professional:
- Onboarding profile
- Category selection
- Matched jobs
- Job detail
- Apply/pitch
- Messages
- Progress timeline

Admin:
- Verification review queue
- User/job context panel
- Approve/reject review action

## Screen Set

1. Landing/login/register role choice
   - Left side: compact Accordia promise and role cards.
   - Right side: auth panel with phone, email, password, role selector, and OTP step.
   - Primary action: "Create account".
   - Secondary action: "Sign in".

2. Client dashboard
   - Metrics: open jobs, applicants, unread messages, jobs in progress.
   - Main list: active jobs with status, category, location, views, applicants.
   - Right rail: verification status, next actions, recent messages.

3. Client post job
   - Form sections: job basics, category/location, budget, expected timeline.
   - Preview card: how professionals will see the job.
   - Use Nigerian currency and state/location fields.

4. Client applicants/review/award
   - Applicant list with pitch excerpt, proposed rate, category fit, verification badge.
   - Detail panel with profile summary, pitch, message action, shortlist, award.
   - Award confirmation explains direct payment agreement happens outside Accordia.

5. Professional onboarding/category selection
   - Bio, location, rate, availability toggle.
   - Category chips from seeded categories.
   - Phone verification card as first trust milestone.

6. Professional matched job feed
   - Filter bar: category, state, remote/on-site, budget.
   - Job cards with title, budget, location, status, client verification, application count.
   - Empty state should tell pros to update categories.

7. Professional apply/pitch
   - Job summary left; structured pitch form right.
   - Fields: pitch, proposed rate, earliest start, questions/assumptions.
   - Submit creates an application and a message record.

8. Messaging view
   - Thread list grouped by job.
   - Conversation area with job context header and async message composer.
   - Show status labels like "Application sent", "Awarded", "In progress".

9. Job progress timeline
   - Current status stepper: Posted, In discussion, Awarded, In progress, Review, Delivered, Closed.
   - Timeline log cards with user, timestamp, note, and status change.
   - Update panel for participants to add status updates.

10. Admin verification/review queue
   - Queue table with user, role, phone status, document type, submitted date, risk notes.
   - Detail panel with masked values, uploaded document placeholder, approve/reject actions.
   - Keep it practical and audit-friendly.

## Visual System

Color:
- Primary: `#176B87` deep teal for trust and action.
- Accent: `#F5A524` amber for award/attention states.
- Success: `#16A34A`.
- Warning: `#D97706`.
- Danger: `#DC2626`.
- Ink: `#102A43`.
- Muted text: `#62748A`.
- App background: `#F6F8FB`.
- Surface: `#FFFFFF`.
- Border: `#D9E2EC`.

Typography:
- Use Inter or a similar neutral sans.
- Page titles: 28-32px, semibold.
- Section titles: 16-20px, semibold.
- Body: 14-16px.
- Tables and dense cards: 12-14px.

Spacing:
- 8px base spacing.
- Dashboard columns: 24px gutters.
- Cards and controls: 8px radius.
- Inputs/buttons: 44-48px height for touch comfort.
- Dense lists should preserve generous row height around 64-84px.

Components:
- App shell with left navigation and top bar.
- Role cards.
- Trust badge.
- Status pill.
- Category chip.
- Job card.
- Applicant card.
- Message thread item.
- Timeline event.
- Admin review table row.
- Empty state block.

## Build Order

1. Auth/register/login with role choice and phone field.
2. Role-specific profile/onboarding, including professional category selection.
3. Client post job and client dashboard.
4. Professional matched job feed and job detail.
5. Apply/pitch flow and applicant review.
6. Award job and messages.
7. Progress timeline.
8. Admin verification queue.

## Copy Direction

Use plain operational language:
- "Post a job"
- "Matched jobs"
- "Apply with pitch"
- "Award job"
- "Agree payment directly"
- "Phone verified"
- "In review"

Avoid language that implies payments or escrow:
- Do not use "Pay now", "Wallet", "Withdraw", "Escrow", or "Release funds" in MVP screens.
