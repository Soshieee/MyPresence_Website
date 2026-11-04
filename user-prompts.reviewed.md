# MyPresence Prompt Review and Corrected Prompt Set

**Status:** Review and implementation plan completed. The approved corrective migration and Verification Center UI now exist in the working tree. The SQL has **not** been applied to the live database, and nothing has been committed or pushed. The original `user-prompts.txt` is preserved unchanged.

---

## 1. Verdict on the original prompts

| Prompt | What it actually is | Verdict | Main problem |
|---|---|---|---|
| 1 | A bug report/question about duplicate posts with images | Not implementation-ready | No app/file context, no reproduction steps, no expected schema behavior, no acceptance criteria |
| 2 | "explain this" | Unusable | There is no "this"; no code, screenshot, error, or file is referenced |
| 3 | Poll creation and hashtag management | Closest to usable, but incomplete | Does not name the existing poll columns or data-preservation rules; the agent created and applied new tables without the required approval |
| 4 | Lifegroup graph tab | Not implementation-ready | No route, data source, graph component, permissions, or acceptance criteria; ends with "don't do anything yet" |

**Overall:** only Prompt 3 is close to a real implementation prompt. Prompts 1, 2, and 4 are not actionable without guessing. None of the four prompts covers the **Centralized Verification Center**, which is the active task.

The other AI also skipped the required Phase 1 deliverable: a database impact report presented *before* modifying the database. It created and applied:
- `supabase/patch_2026_11_03_verification_center.sql`
- `supabase/patch_2026_11_03_social_post_review_cascade.sql`

and changed `social_posts`, `social_post_images`, `profiles` behavior, `verification_submissions`, `verification_reviews`, `is_admin()`, `is_social_admin()`, and the `social_feed` view.

---

## 2. What the other AI got right

- Added a `/verification` route and a sidebar entry.
- Added tabs for All Requests, Social Feed, User Verification, Profile Picture, and Lifegroup Leader.
- Added search and a status filter, defaulting to Pending.
- Added a confirmation dialog for Accept/Reject.
- Required a rejection reason and stored it.
- Added `verification_submissions` and `verification_reviews` tables.
- Added an admin-only `review_verification` RPC with a self-review check for the three dedicated submission categories.
- Kept the existing `profiles.profile_img_url` as the active profile picture on approval.
- Lint and production build pass.

Those are useful foundations, but the implementation does not meet the core architecture or security requirements.

---

## 3. Critical findings in the current implementation

### 3.1 The live feed exposes rejected and pending images

This is the most serious issue. The live `social_feed` view returns posts whose images are **rejected** or **pending**, and its `image_paths` array contains those images.

Observed live data:
- 5 `social_posts` rows, all `status = approved`.
- 6 `social_post_images` rows: 2 approved, 2 pending, 2 rejected.
- `social_feed` returns 5 rows.
- Post `810c0e5d-4972-40fb-a49d-938fe6fae4a5` has 2 rejected images, yet `social_feed` returns it with both image paths.
- Post `7dc0b494-f9fd-421d-828e-4ca9ff982986` has 2 pending images, yet `social_feed` returns it with both image paths.

The SQL file in the repo contains a `social_feed` definition that filters approved images and excludes posts with any non-approved image, but the **live view does not match that definition**. Either the patch was not applied, an older version was applied, or a later deployment replaced the view. The SQL file and live database are out of sync.

Also, the underlying `social_post_images` SELECT policy allows anon to read any image whose parent post is approved, regardless of the image's own status. Even if the view were fixed, anon could query `social_post_images` directly and see rejected/pending images.

**Required fix:** filter by `social_post_images.status = 'approved'` in both the public view and the image RLS policy, and confirm the live view definition before changing it.

### 3.2 Content and image verification are not independent

- The last commit removed the separate image submission rows from the verification page.
- The page now shows one social item per post, with a single Approve/Reject action for `social_posts.status`.
- Images are displayed only as status badges; they cannot be approved or rejected individually.
- `patch_2026_11_03_social_post_review_cascade.sql` makes a content decision update **all** images to the same decision.
- Approving content therefore auto-approves images; rejecting content auto-rejects images.

This directly violates the requirement that content and each image have independent statuses and independent review actions.

### 3.3 User verification does not grant a verified status

The live `profiles` table has no verification column. Probed and confirmed absent:
`is_verified`, `verified`, `verification_status`, `member_status`, `membership_status`, `approved`, `approval_status`, `verified_at`.

The RPC for `category = 'user'` only updates `verification_submissions.status`. It does not update `profiles`, and the mobile app cannot read `verification_submissions` because the RLS policy is admin-only. Approving a user therefore grants nothing and notifies nobody.

The user said verification should be based on `profiles`, but the current schema has no field to hold that status. This must be resolved before user verification can work.

### 3.4 Mobile submissions are blocked by RLS

The new `verification_submissions` policy is:

```sql
for all to authenticated
using (public.is_admin())
with check (public.is_admin());
```

A normal authenticated user cannot insert a submission, cannot read their own submission, and cannot read the rejection reason. If the mobile app uses the anon key with a user session, every user/profile-picture/lifegroup-leader submission will fail with an RLS error.

Required policy shape:
- Users can insert only their own rows, with `status = 'pending'`.
- Users can select only their own rows.
- Users cannot update or delete rows.
- Admins can select all rows.
- Admin decisions go through the audited RPC, not direct table writes.

### 3.5 Users can self-approve posts and images

The live RLS policies do not restrict the `status` column:

- `social_posts` INSERT: `with check (user_id = auth.uid())` only. A user can insert a post with `status = 'approved'`.
- `social_post_images` INSERT: checks parent ownership and parent `status = 'pending'`, but not the image status. A user can insert an image with `status = 'approved'`.
- `social_post_images` UPDATE: same ownership/parent check, but no status restriction. A user can update their own image to `approved` while the parent post is pending.

The RPC also does not block an admin from reviewing their own social post or image; the self-review check only covers `verification_submissions`.

**Required fix:** force `status = 'pending'` on user inserts and block non-admin status changes with a trigger or column-level privileges. Add a self-review check for every category.

### 3.6 The migration auto-approved existing images

`patch_2026_11_03_verification_center.sql` contains:

```sql
update public.social_post_images
set status = 'approved'
where status = 'pending'
  and created_at < timezone('utc', now());
```

Because `created_at` is always in the past, this approves every existing pending image without human review. That violates the "do not automatically approve submissions" rule. Existing images should have been left pending, or their status should have been confirmed with the user first.

### 3.7 The RPC is not idempotent and does not preserve history correctly

`review_verification` updates the target row by `id` only. It does not:
- lock the row,
- require the current status to be `pending`,
- reject duplicate decisions,
- record the previous status,
- prevent an admin from reviewing their own social post/image.

A double-click or retry can write duplicate audit rows and change a rejected item back to approved.

### 3.8 The UI is missing required features

The current `/verification` page does not have:
- the four overview cards (Pending, Approved, Rejected, Total),
- independent image review actions,
- an overall publishing status for social posts,
- a review-history panel,
- sorting controls,
- pagination,
- lifegroup name / current leader display,
- a clear content-status vs image-status vs overall-status presentation,
- an admin-only navigation guard (non-admins see the page and get an error instead of being redirected or having the nav item hidden).

The page also loads all posts, images, and submissions in one request, which will not scale.

### 3.9 Admin-role functions were redefined without confirming the originals

`is_admin()` and `is_social_admin()` were replaced with new definitions. The live `app_admins` table exists, and the new `is_admin()` checks `app_metadata.role = 'admin'` or membership in `app_admins`. That may be correct, but the original definitions were never confirmed. Replacing these functions affects every RLS policy that uses them. This is a cross-cutting security change and should not be made without the original function definitions and an explicit approval.

### 3.10 Storage policies are missing

The page uses signed URLs for social images and avatars, and reads verification documents from a bucket named in `submission_data.storage_bucket`. The migration does not add storage policies. If those buckets are private, admin previews will fail; if they are public, rejected/supporting documents may be exposed. This needs an explicit storage policy review.

---

## 4. Database Impact Report (the report that should have been presented first)

| Verification Category | Existing Table(s) | Relevant Records | Relevant Columns | Proposed Changes |
|---|---|---|---|---|
| Social Feed Post | `social_posts`, `social_post_images` | 5 posts, 6 images in the live project | `social_posts.status`, `rejection_reason`, `reviewed_at`, `reviewed_by`; `social_post_images.status`, `rejection_reason`, `reviewed_at`, `reviewed_by`, `storage_path`, `sort_order` | Keep content status on `social_posts`; keep per-image status on `social_post_images`; remove the cascade; derive overall status in the backend/view; fix the public image policy and feed view |
| User Verification | `profiles`, `verification_submissions` | No confirmed verification column; submissions currently hidden by RLS | `profiles.id`, `first_name`, `last_name`, `profile_img_url`; `verification_submissions.category`, `user_id`, `status`, `submission_data` | Decide the authoritative verified flag/table. Either add the smallest `profiles` verification column or make `verification_submissions` readable by its owner and use it as the source of truth. Do not just mark the submission approved. |
| Profile Picture | `profiles.profile_img_url`, `verification_submissions` | Existing `profile_img_url` values; new submissions | `profiles.profile_img_url`; `verification_submissions.storage_path`, `status` | Keep the current approved picture in `profiles.profile_img_url`; approval replaces it; rejection leaves it untouched. Add storage policies. |
| Lifegroup Leader | `lifegroups`, `lifegroup_members`, `verification_submissions` | Existing lifegroups and memberships | `lifegroups.leader_id`; `lifegroup_members.role`, `status`; `verification_submissions.lifegroup_id`, `user_id`, `status` | Confirm which column is authoritative. Update `lifegroups.leader_id` and, if required by the app, `lifegroup_members.role/status` in one transaction. Do not remove the member. |

### 4.1 Current live schema facts

Use these; do not invent columns.

**`social_posts`**
`id`, `user_id`, `author_display_name`, `author_avatar_url`, `caption`, `status`, `created_at`, `expires_at`, `reviewed_at`, `reviewed_by`, `rejection_reason`.
`status` is `pending | approved | rejected`.

**`social_post_images`**
`id`, `post_id`, `storage_path`, `sort_order`, `created_at`, `status`, `reviewed_at`, `reviewed_by`, `rejection_reason`.

**`profiles`**
`id` (Supabase Auth user id), `first_name`, `last_name`, `profile_img_url`, `gender`, `birthday`, `network`, `created_at`, `updated_at`.
There is **no** verification status column.

**`verification_submissions`**
`id`, `category` (`user | profile_picture | lifegroup_leader`), `user_id`, `lifegroup_id`, `storage_path`, `submission_data`, `status`, `rejection_reason`, `created_at`, `reviewed_at`, `reviewed_by`.

**`verification_reviews`**
`id`, `target_id`, `category` (`social_post | social_post_image | user | profile_picture | lifegroup_leader`), `component`, `reviewer_id`, `decision`, `comments`, `reviewed_at`.

**`lifegroups`**
`id`, `name`, `description`, `leader_id`, `leader_contact`, `join_mode`, `status`, `created_at`, `updated_at`.

**`lifegroup_members`**
`id`, `lifegroup_id`, `user_id`, `role`, `status`, `joined_at`, `created_at`, `updated_at`.

**`social_feed`**
Live columns observed: `id`, `user_id`, `author_display_name`, `author_avatar_url`, `caption`, `created_at`, `expires_at`, `image_paths`, `hashtags`.
The live view currently exposes all images of approved posts, including rejected/pending images. Confirm its definition before replacing it.

### 4.2 Existing RLS facts that matter

From the supplied RLS CSV:

- `social_posts` SELECT: approved and not expired, or owner, or `is_social_admin()`.
- `social_posts` INSERT: only `user_id = auth.uid()`; no status restriction.
- `social_posts` UPDATE: `is_social_admin()`.
- `social_posts` DELETE: owner or `is_social_admin()`.
- `social_post_images` SELECT: parent approved and not expired, or owner, or `is_social_admin()`; **no image-status restriction**.
- `social_post_images` INSERT: parent owner and parent `status = 'pending'`; no image-status restriction.
- `social_post_images` UPDATE: same as INSERT; no image-status restriction.
- `social_post_images` DELETE: parent owner and parent pending, or `is_social_admin()`.
- `profiles` SELECT: owner or `is_admin()`.
- `lifegroups` SELECT: leader, member, or `is_admin()`.
- `lifegroups` UPDATE: leader only.
- `lifegroup_members` SELECT: own membership, group leader, or `is_admin()`.
- `verification_submissions` (new): admin-only `for all`.
- `verification_reviews` (new): admin-only SELECT.

---

## 5. Corrected prompts

### Prompt 1 — Duplicate posts when submitting images

**Use this instead of the original Prompt 1.**

> **Task: Fix duplicate social post creation when a post has multiple images.**
>
> Project: MyPresence mobile app (post submission) and Supabase backend. The web repo is `MyPresence_Website`; the mobile code may be in a separate app directory. Do not assume the web repo contains the upload code.
>
> **Observed bug:** Submitting one post with two images creates three `social_posts` rows: one post with both images, plus two separate posts with one image each.
>
> **Investigate before changing anything:**
> 1. Find the function that uploads images and inserts into `social_posts` and `social_post_images`.
> 2. Determine whether the post insert is inside an image loop, whether a per-image "create post" helper is called, or whether the client retries the whole submission.
> 3. Confirm the intended relationship: one `social_posts` row, one `social_post_images` row per image, same `post_id`, `sort_order` 0..N-1.
> 4. Check for duplicate submit handlers, double navigation, or a retry that lacks an idempotency key.
>
> **Required behavior:**
> - One post row per submission.
> - N image rows for N images, all linked to that post.
> - No post row per image.
> - If the request is retried, it must not create a second post.
> - Existing verification status must remain independent per image.
>
> **Constraints:**
> - Do not add or change database columns/tables without approval.
> - Do not auto-approve posts or images.
> - Do not delete existing data.
> - Do not commit or push.
>
> **Deliverable:** root cause, files changed, before/after behavior, and tests with 0, 1, 2, and 5 images. Verify the feed shows one post with N images and the verification center shows one submission with N image components.

### Prompt 2 — "Explain this"

**Use this instead of the original Prompt 2.** The original has no referent, so it cannot be answered reliably.

> **Task: Explain the following behavior without changing code.**
>
> Context:
> - Feature/route: `<fill in>`
> - File(s): `<fill in>`
> - Table(s)/function(s): `<fill in>`
> - Observed behavior: `<fill in>`
> - Expected behavior: `<fill in>`
> - Error/log/screenshot: `<paste or attach>`
>
> Explain:
> 1. The current control flow, citing file paths and line numbers.
> 2. Which database tables/columns and RLS policies are involved.
> 3. Why the observed behavior happens.
> 4. What would need to change, with the smallest safe fix.
> 5. What must be confirmed before changing the database.
>
> Do not modify code or database objects in this task.

### Prompt 3 — Poll creation and event hashtags

**Use this instead of the original Prompt 3.** This version names the existing schema and closes the data-loss/approval gaps.

> **Task: Simplify poll creation and add event/poll hashtag management.**
>
> **Inspect first; do not modify the database yet.**
>
> Known schema to verify:
> - `event_suggestions`: `id`, `event_id`, `suggestion_text`, `main_question`, `suggestion_question_text`, `poll_name`, `poll_starts_at`, `poll_ends_at`, `created_at`, `poll_key`, `item_kind`, `poll_status`, `archived_at`, `sort_order`, `updated_at`.
> - `social_hashtags`: `id`, `name`, `normalized_name`, `is_default`, `is_active`, `created_at`.
> - `social_post_hashtags`: existing post-to-hashtag join.
> - Confirm whether `event_hashtags` and `poll_hashtags` already exist. If they do not, propose them and wait for approval.
>
> **Requirements:**
> 1. Remove the Poll Name and Main Question inputs from poll creation.
> 2. Label polls using the event type. Do not create a new editable poll title.
> 3. Add a `#Hashtags` picker to poll creation. Use active `social_hashtags`; allow search; show selected chips; prevent duplicates.
> 4. Add a Hashtags section to event creation. Show default and newly created hashtags; allow selection; create new hashtags with normalization and case-insensitive duplicate prevention.
> 5. Persist event-to-hashtag and poll-to-hashtag associations.
> 6. Preserve existing poll data. Do not null out `poll_name` or `main_question` for existing rows unless the user explicitly approves that data migration.
> 7. Save associations transactionally. Do not delete all links and then insert without rollback; a failed insert must not erase the previous links.
> 8. Confirm whether hashtag writes are admin-only or available to all authenticated event managers. Do not silently restrict or broaden access.
> 9. Use the existing notification system for success/error feedback.
>
> **Stop and present:**
> - A database impact report with exact tables, columns, rows, and proposed SQL.
> - The RLS policies for the new/changed tables.
> - The migration/rollback plan.
> - Wait for explicit approval before applying anything.
>
> **Acceptance criteria:**
> - Poll Name and Main Question inputs are gone.
> - Poll labels come from event type.
> - Hashtags can be searched, selected, created, and persist after refresh.
> - Duplicates are prevented regardless of capitalization.
> - Existing polls, votes, and associations are preserved.
> - Existing event and poll functionality still works.

### Prompt 4 — Lifegroup graph tab

**Use this instead of the original Prompt 4.**

> **Task: Add a lifegroup graph tab using the existing lifegroup tables and the existing graph component.**
>
> **Do not change the database. Do not add or remove tables. Do not implement until the data query and component choice are approved.**
>
> Known schema:
> - `lifegroups`: `id`, `name`, `description`, `leader_id`, `leader_contact`, `join_mode`, `status`, `created_at`, `updated_at`.
> - `lifegroup_members`: `id`, `lifegroup_id`, `user_id`, `role`, `status`, `joined_at`, `created_at`, `updated_at`.
> - `lifegroup_activities`: `id`, `lifegroup_id`, `created_by`, `title`, `description`, `location`, `starts_at`, `ends_at`, `lesson`, `status`, `created_at`, `updated_at`.
> - `lifegroup_activity_rsvps`: `id`, `activity_id`, `user_id`, `response`, `created_at`, `updated_at`.
> - `profiles`: `id`, `first_name`, `last_name`, `profile_img_url`.
>
> **Requirements:**
> 1. Add a new tab/page under the existing navigation.
> 2. Use the same graph component/style already used in the system, not a static image.
> 3. Nodes: lifegroups and, where useful, members/leaders.
> 4. Edges: membership (`lifegroup_members`) and leadership (`lifegroups.leader_id`).
> 5. Show lifegroup name, leader name, member count, and status.
> 6. Add filters for lifegroup status and role if useful.
> 7. Handle loading, empty, error, and responsive states.
> 8. Respect existing RLS. Do not weaken policies. Confirm whether the page is admin-only.
> 9. Do not expose member data to unauthorized users.
>
> **Before implementation, present:**
> - The exact query/join plan.
> - The graph component you will reuse.
> - The route and navigation change.
> - The permission model.
> - A mockup or data-shape description.
> - Wait for approval.
>
> **Acceptance criteria:**
> - The tab renders the real graph from Supabase, not a picture.
> - Leaders and members are distinguishable.
> - The graph matches the existing visual language.
> - No database changes are made.

### Prompt 5 — Centralized Verification Center

**This is the prompt that should have been used for the current task.**

> **Task: Implement the Centralized Verification Center in `MyPresence_Website`.**
>
> **Role split:** the mobile app creates submissions; the web app lets authorized administrators review them manually. Do not auto-approve anything.
>
> **Phase 0 — inspect, report, and stop.**
> Before changing code or database objects:
> 1. Inspect the live schema, RLS policies, storage policies, and existing verification code.
> 2. Produce a database impact report with the exact tables, columns, rows, and proposed changes for all four categories.
> 3. Present the report and ask for explicit confirmation of the exact tables/columns.
> 4. Do not apply migrations, create tables, alter columns, change RLS, commit, or push until approved.
>
> **Known live schema (verify, do not invent):**
> - `social_posts`: `id`, `user_id`, `author_display_name`, `author_avatar_url`, `caption`, `status`, `created_at`, `expires_at`, `reviewed_at`, `reviewed_by`, `rejection_reason`; `status` is `pending | approved | rejected`.
> - `social_post_images`: `id`, `post_id`, `storage_path`, `sort_order`, `created_at`, `status`, `reviewed_at`, `reviewed_by`, `rejection_reason`.
> - `profiles`: `id` (auth user id), `first_name`, `last_name`, `profile_img_url`, `gender`, `birthday`, `network`, `created_at`, `updated_at`; **no verification status column exists**.
> - `verification_submissions`: `id`, `category`, `user_id`, `lifegroup_id`, `storage_path`, `submission_data`, `status`, `rejection_reason`, `created_at`, `reviewed_at`, `reviewed_by`.
> - `verification_reviews`: `id`, `target_id`, `category`, `component`, `reviewer_id`, `decision`, `comments`, `reviewed_at`.
> - `lifegroups`: `id`, `name`, `description`, `leader_id`, `leader_contact`, `join_mode`, `status`, `created_at`, `updated_at`.
> - `lifegroup_members`: `id`, `lifegroup_id`, `user_id`, `role`, `status`, `joined_at`, `created_at`, `updated_at`.
> - `social_feed`: live columns include `id`, `user_id`, `author_display_name`, `author_avatar_url`, `caption`, `created_at`, `expires_at`, `image_paths`, `hashtags`; the live view currently exposes rejected/pending images and must be fixed.
>
> **Known blockers to resolve with the user:**
> 1. `profiles` has no verified/membership status. Confirm whether to add the smallest `profiles` column or use `verification_submissions` as the mobile-readable source of truth.
> 2. Confirm whether `lifegroups.leader_id` or `lifegroup_members.role` is the authoritative leader assignment. Update both only if confirmed.
> 3. Confirm the mobile notification table/API; the web app's toast is not a user notification.
> 4. Confirm the storage buckets and policies for `avatars`, `social-post-images`, and verification documents.
> 5. Confirm the original definitions of `is_admin()` and `is_social_admin()` before replacing them.
>
> **Architecture — non-negotiable:**
> - Four independent categories: social post, user verification, profile picture, lifegroup leader.
> - Approving/rejecting one category must never change another category.
> - Social post content and each image are independent review components.
> - A post publishes only when content is approved and every attached image is approved; no image means only content is required.
> - If content or any image is rejected, the post must not publish.
> - Preserve each component's status and audit history. Do not cascade a content decision onto images.
> - Overall status must be derived by the backend/view or updated by a reliable server-side process, not by the frontend alone.
> - Rejected content/images must be replaceable by a new attempt, and the new attempt must be reviewed again.
>
> **Database/security requirements to propose (do not apply yet):**
> 1. Remove the content-to-image cascade from `review_verification`.
> 2. Require `status = 'pending'`, lock the row, and prevent duplicate decisions in `review_verification`.
> 3. Prevent an admin from reviewing their own submission in every category.
> 4. Force `status = 'pending'` on user inserts to `social_posts` and `social_post_images`; block non-admin status changes with a trigger or column privileges.
> 5. Fix `social_post_images` SELECT so anon/public can read only approved images.
> 6. Fix `social_feed` so it includes only approved posts, only approved image paths, and excludes any post with a non-approved image. Confirm the live definition first.
> 7. Add `verification_submissions` RLS: users insert their own rows with `status = 'pending'`; users cannot update/delete raw rows; admins select all; decisions go through the audited RPC; expose the user's own status through a secured RPC/view without documents or storage paths.
> 8. Do not auto-approve existing images. Leave existing rows pending or preserve their current status per an explicit rule.
> 9. Add storage policies for private images/documents and use signed URLs for admin previews.
> 10. Keep `verification_reviews` append-only. Do not allow direct admin table updates that bypass the audit trail.
>
> **UI requirements:**
> - Add a Verification page to the admin navigation, visible only to authorized admins.
> - Summary cards: Pending, Approved, Rejected, Total, using real data and updating after decisions.
> - Tabs: All Requests, Social Feed Posts, User Verification, Profile Pictures, Lifegroup Leaders.
> - Default status filter: Pending.
> - Search by member name/submission information; category filter; status filter; sort by submission date; pagination.
> - Submission cards: type, submitter, date/time, current status, preview, actions.
> - Social detail: content text, each image, content status/actions, each image status/actions, overall publishing status, review history.
> - User detail: profile information, submitted evidence, current verification status, review history.
> - Profile picture detail: large submitted preview, current approved picture for comparison, status, review history.
> - Lifegroup detail: member, lifegroup name, current leader, submitted information, status, review history.
> - Accept: confirmation dialog; process only the selected component; update only that status; refresh data.
> - Reject: confirmation dialog; require a reason; store it; preserve the submission and history.
> - Loading, empty, success, error, and responsive states.
> - Reuse existing components/classes; do not redesign unrelated pages.
>
> **Notifications/audit:**
> - Record reviewer, decision, component, reason, and timestamp in `verification_reviews`.
> - Display the review history in the detail panel.
> - If the mobile notification table/API is confirmed, create a notification for the affected user; otherwise document that it is deferred and why.
>
> **Acceptance criteria:**
> - All four categories are visible and independently reviewable.
> - Overview counts match the database.
> - Search, category filter, status filter, sorting, and pagination work.
> - Content and image decisions are independent; no cascade.
> - A post with content approved and an image pending is not published.
> - A post with any rejected component is not published.
> - A post without images publishes after content approval.
> - Approved user verification grants the confirmed verified status/permission.
> - Rejected user verification grants nothing and does not delete the account.
> - Approved profile picture becomes active; rejected picture does not, and the previous picture remains.
> - Approved lifegroup leader gets the confirmed leader permission; rejected leader gets nothing; membership is preserved.
> - No cross-category approval occurs.
> - Unauthorized users cannot read or act on verification data.
> - Duplicate decisions and self-review are blocked by the backend.
> - Build and lint pass.
>
> **Deliverable:** impact report first; then the UI; then the approved backend changes; then tests. Do not commit, push, or apply SQL until explicitly approved.

---

## 6. Confirmation needed before any fix

Please confirm the following, because they change the database or permissions:

1. **User verification:** add a `profiles` column (name/type?) or use `verification_submissions` as the mobile-readable source of truth? `profiles` currently has no verification field.
2. **Lifegroup leader:** is `lifegroups.leader_id` authoritative, or is `lifegroup_members.role = 'leader'` authoritative? Should approval update both?
3. **Social feed:** approve replacing the live `social_feed` view with the filtered definition, and fixing `social_post_images` SELECT to hide non-approved images from anon/public?
4. **Social post/image RLS:** approve triggers/column privileges that force `status = 'pending'` on user inserts and block non-admin status changes?
5. **Verification submissions RLS:** approve user insert/select-own policies and admin-only audited decisions?
6. **Existing image statuses:** leave the current 2 pending / 2 rejected images as-is, or reset all existing images to pending? (Do not auto-approve.)
7. **Admin functions:** provide the original `is_admin()` / `is_social_admin()` definitions before they are replaced again.
8. **Notifications/storage:** provide the mobile notification table/API and the bucket names/policies, or confirm they are deferred.

---

## 7. Implemented changes in the working tree (2026-11-04)

### Files changed

| File | Change |
|---|---|
| `supabase/patch_2026_11_04_verification_fixes.sql` | New corrective migration. Transactional. Must be run once in the Supabase SQL Editor. |
| `src/app/verification/page.tsx` | Verification Center rewritten for admin-only access, server-side filtering/pagination, independent content/image review, audit history, and responsive states. |
| `src/components/app-shell.tsx` | Calls `is_admin()` after authentication and hides the Verification navigation item from non-admins. |

### Database objects created or replaced

**Views**

- `public.social_feed` — replaced. Uses `security_invoker = true`. Returns only approved, unexpired posts; only approved image paths; excludes any post with a non-approved image. A post with no images is eligible after content approval.
- `public.verification_requests` — new admin-only read view. Combines social posts and verification submissions, derives the social post overall status from content plus every image, exposes image counts, lifegroup/current-leader information, and supports server-side search/filter/sort/pagination. Uses `security_invoker = true` and filters with `public.is_admin()`.

**Functions**

- `public.social_post_has_nonapproved_images(uuid)` — new narrow `SECURITY DEFINER` helper. Returns only a boolean and only for approved, unexpired posts.
- `public.guard_social_post_review_fields()` — new trigger function.
- `public.guard_social_post_image_review_fields()` — new trigger function.
- `public.guard_verification_submission_review_fields()` — new trigger function.
- `public.get_my_verification_status()` — new authenticated RPC. Returns the latest status per submission category for `auth.uid()` without documents, storage paths, reviewer notes, or full submission data.
- `public.review_verification(uuid, text, text, text, text)` — replaced. Locks the target row, requires `pending`, blocks duplicate decisions, blocks self-review, requires a rejection reason, records the audit row, and performs profile-picture or lifegroup-leader side effects in the same transaction.
- `public.is_admin()` and `public.is_social_admin()` — **not redefined**. Their live definitions are preserved.

**Triggers**

- `guard_social_post_review_fields` on `public.social_posts`.
- `guard_social_post_image_review_fields` on `public.social_post_images`.
- `guard_verification_submission_review_fields` on `public.verification_submissions`.

The triggers force user inserts to `pending`, clear review metadata on insert, and block direct authenticated/anon changes to `status`, `reviewed_at`, `reviewed_by`, or `rejection_reason`. Trusted `SECURITY DEFINER` review functions run as their owner and are allowed through.

**RLS policies**

- `social_posts_select` (authenticated) — approved/unexpired, owner, or social admin.
- `social_posts_public_select` (anon) — approved/unexpired only.
- `social_posts_admin_select` (authenticated) — `is_admin()`.
- `social_post_images_select` (authenticated) — approved image of approved/unexpired post, owner, or social admin.
- `social_post_images_public_select` (anon) — approved image of approved/unexpired post only.
- `social_post_images_admin_select` (authenticated) — `is_admin()`.
- `social_posts_insert` — own post with `status = 'pending'`.
- `social_post_images_insert` — own pending post, image `status = 'pending'`.
- `social_post_images_update` — own pending post, image must remain `pending`.
- `Users can insert their own verification submissions` — own row with `status = 'pending'`.
- `Admins can read verification submissions` — `is_admin()`.
- `Admins can read verification reviews` — `is_admin()`.

**Privileges**

- `verification_submissions`: anon/public revoked; authenticated receives `select, insert`; update/delete revoked.
- `verification_reviews`: anon/public revoked; authenticated receives `select`; insert/update/delete revoked so decisions go through the audited RPC.
- `verification_requests`: anon/public revoked; authenticated receives `select`.
- `get_my_verification_status()` and `review_verification(...)`: anon/public revoked; authenticated receives execute.
- `social_feed`: `select` granted to anon and authenticated.
- `social_post_has_nonapproved_images(uuid)`: execute granted to anon and authenticated.

**Storage policies**

- `verification_admins_read_social_post_images` — additive admin read access to the private `social-post-images` bucket.
- `verification_admins_read_avatars` — additive admin read access to the `avatars` bucket.

No bucket was made public, no existing storage policy was replaced, and no object was deleted.

### Behavioral effects

- A social post appears in `social_feed` only when its content is approved and every attached image is approved (or no images exist).
- Content and each image have independent statuses and independent review actions.
- A rejected image or rejected content keeps the post out of the public feed.
- Existing image statuses are untouched: 2 pending and 2 rejected remain pending/rejected.
- User-created posts/images cannot self-approve.
- Direct admin table updates cannot bypass the audit trail.
- Duplicate decisions and self-review are rejected by the backend.
- Approving a profile picture updates `profiles.profile_img_url`; rejecting leaves the current picture unchanged.
- Approving a lifegroup leader updates `lifegroups.leader_id` and synchronizes the member row to `role = 'leader', status = 'active'` in one transaction. Existing membership rows are not deleted.
- User verification remains sourced from `verification_submissions`; no `profiles` verification column was added.

### Verification performed

- `npm run lint` passes.
- `npm run build` passes.
- The UI has explicit loading, empty, error, success, denied-access, and confirmation-dialog states.
- The UI uses real database counts and server-side pagination.
- The UI checks `is_admin()` before loading review data, and the AppShell hides the Verification navigation item for non-admins.

### Still requires the live environment

- Run `supabase/patch_2026_11_04_verification_fixes.sql` in the Supabase SQL Editor.
- Test with a real administrator: all four tabs, content/image decisions, rejection reason, profile-picture approval/rejection, lifegroup leader approval, review history, counts, search, filters, sorting, pagination.
- Test with a regular authenticated user: `/verification` must deny access, the navigation item must be hidden, direct RPC calls must fail, and `get_my_verification_status()` must return only that user's status.
- Test anonymous access: `social_feed` must not expose pending/rejected images, and direct `social_post_images` reads must return only approved images of approved posts.

### Known limits

- Live `is_admin()` / `is_social_admin()` definitions were not available, so they were deliberately not changed.
- Live storage policies could not be inspected with the available anon key; the migration only adds narrow admin-read policies.
- Mobile push notifications remain deferred; the web app uses its existing in-app toast/notification component.
- No commit or push was performed.

---

## 8. Follow-up fixes (2026-11-05)

### New file

| File | Change |
|---|---|
| `supabase/patch_2026_11_05_verification_lifegroup_and_post_review.sql` | Transactional follow-up migration. Must be run after the 2026-11-04 migration. |
| `src/app/verification/page.tsx` | Social posts now use one whole-post decision; per-image approve/reject buttons were removed. |

### Why the pending lifegroup was missing

The mobile app's "Under review" lifegroup card is backed by `public.lifegroups`, not `public.verification_submissions`:

- `lifegroups` has a `status` column with a default of `'active'`; a pending application is a row with `status = 'pending'`.
- `lifegroup_members` also has a `status` column defaulting to `'pending'`; a pending leader membership is another possible signal.

The 2026-11-04 `verification_requests` view only read `verification_submissions` for lifegroup requests, so a pending row in `lifegroups` was invisible to the web Verification Center. The follow-up view adds a third source:

- `lifegroups` rows whose own status is `pending`,
- or whose leader membership is `pending`,
- or that already have a `lifegroup_leader` review row (so approved/rejected history stays visible).

It normalizes the lifegroup state to `pending` / `approved` / `rejected` for the web list and exposes the group name, description, leader contact, join mode, and current leader.

### Review behavior changes

- `review_verification(...)` now accepts `p_category = 'lifegroup_leader'` with either a `verification_submissions.id` or a `lifegroups.id`. The submission path is tried first; if no submission row exists, the lifegroup row is reviewed directly.
- Approving a lifegroup application sets `lifegroups.status = 'active'`, keeps `leader_id`, and synchronizes the leader membership to `role = 'leader', status = 'active'`. A new `VERIFICATION_LIFEGROUP_ALREADY_LED` guard refuses approval when a different primary leader (or a different active leader membership) already exists, so an application cannot silently replace leadership.
- Rejecting a lifegroup application sets `lifegroups.status = 'rejected'`, preserves the lifegroup and membership rows, and records the reason in `verification_reviews`.
- If a submission and a lifegroup row both exist for the same application, reviewing the submission also updates the lifegroup status so the mobile card stays in sync.
- Social posts now use `p_component = 'post'`. One decision updates the post content and every attached image in the same transaction. The audit history records one post row plus one row per image.
- The old `content` and `image` RPC branches remain for backward compatibility, but the Verification Center no longer calls them.
- `get_my_verification_status()` now also returns the user's own lifegroup application status, without exposing other users' data.

### UI behavior changes

- The per-image Approve/Reject buttons are gone. Images still show their status and rejection reason.
- Each social post now has a single Approve/Reject action. The confirmation dialog explains that the content and all images are reviewed together.
- Rejecting a post requires a reason and hides the whole post from the feed.
- The header and empty-state copy were updated to match whole-post review.

### Verification performed

- `npm run lint` passes.
- `npm run build` passes.
- The live `verification_requests` view already exists (confirmed through the anon REST endpoint returning `permission denied for view`, not `relation does not exist`), so the 2026-11-04 migration was applied.

### Assumption / limitation

The live rows could not be read with the available anon key, so the exact mobile write path was inferred from the schema (`lifegroups.status`, `lifegroup_members.status`, and the "Under review" card). The view and RPC handle both a pending lifegroup row and a pending leader membership. If the mobile app stores the application in a different table, that table and its insert path are still needed to complete the fix.

### Required next step

Run `supabase/patch_2026_11_05_verification_lifegroup_and_post_review.sql` in the Supabase SQL Editor, then refresh the Verification Center. The pending "MichaTestLifegroup" application should appear under **Lifegroup Leaders**. Approve it to activate the group, or reject it with a reason.

---

## 9. Lifegroup analytics, hashtag persistence, and verification hardening (2026-11-05)

### 9.1 Lifegroup Analytics (`src/app/records/page.tsx`)

The Lifegroup Analytics tab no longer derives lifegroup activity from the main `attendance` table. It loads and joins the six existing lifegroup objects:

| Object | Kind | Use |
|---|---|---|
| `public.lifegroups` | table | Group list, name, status, `leader_id`, group filter. |
| `public.lifegroup_members` | table | Membership rows, role, status, member totals, active/inactive totals. |
| `public.lifegroup_activities` | table | Activity count, status breakdown, dates, per-group activity totals. |
| `public.lifegroup_activity_rsvps` | table | RSVP counts and yes/no/maybe breakdown. |
| `public.lifegroup_attendance` | table | Attendance records. This is the authoritative attendance source. |
| `public.lifegroup_attendance_report` | view | Optional per-activity report counts; the page falls back to deduplicated base attendance when the view has no numeric count column. |

Key rules:

- **Membership is not attendance.** Membership totals come from `lifegroup_members`; attendance totals come from `lifegroup_attendance`.
- **RSVPs are not attendance.** RSVP rows are counted separately and are never added to attendance.
- **No double counting.** Membership rows are deduplicated by `(lifegroup_id, user_id)`. Attendance rows are deduplicated by `(activity_id, user_id)` when an activity is present, otherwise by `(lifegroup_id, user_id, date)`. RSVP rows are deduplicated by `(activity_id, user_id)`, keeping the latest response.
- **Status handling.** `lifegroup_members.status` values `active` and `approved` count as active; blank is treated as active for older rows; other statuses (including `pending`) count as inactive. Attendance statuses such as `absent`, `no_show`, `missed`, `declined`, `cancelled`, `excused`, `pending`, and `registered` are not counted as present.
- **Date filtering.** The tab has Last 30 Days, Last 90 Days, All Time, and Custom ranges. All Time includes upcoming scheduled activities; attendance still requires a dated attendance record.
- **Group/member filters.** A group filter scopes every metric. A member filter is enabled only after a specific group is selected and scopes attendance and RSVP rows to that member.
- **Comparisons.** The per-group table shows status, leader, members, active members, activities, attendance, unique attendees, RSVPs, and average attendance per activity.
- **Empty data.** Charts and tables render explicit empty states instead of fabricated values. If the report view is unavailable, the page shows a note and keeps using the base attendance table.

### 9.2 Hashtags (`src/app/events-manager/page.tsx` + migration)

`public.social_hashtags` remains the single canonical catalog. `public.event_hashtags` and `public.poll_hashtags` remain the relationship tables with their existing foreign keys.

Client behavior:

- Input is trimmed, leading `#` characters are stripped, lowercased, and validated as 1–50 letters, numbers, or underscores.
- Duplicate normalized names are rejected before insert and are also protected by the database unique index.
- The insert sends `name`, `normalized_name`, `is_default: false`, and `is_active: true`, then inserts the returned row into local state immediately. A refresh re-reads the catalog from the database.
- Creation is hidden when the account is not a social administrator. The page checks `is_social_admin()` first and falls back to `is_admin()` only when the helper is unavailable. Database RLS remains authoritative.
- Insert failures show the actual error. RLS/permission failures, duplicate-key failures, and invalid-format failures each get a specific message.
- Event and poll hashtag saves are diff-based: existing links are read first, missing links are added, and only removed links are deleted. A partial failure therefore preserves existing associations.
- Poll hashtags are also added to the event-level relationship table so they remain selectable at the event level.

New migration: `supabase/patch_2026_11_05_hashtag_normalization.sql`

- Ensures `normalized_name`, `is_default`, `is_active`, and `created_at` exist.
- Recreates `normalize_social_hashtag(text)` and the `prepare_social_hashtag` trigger.
- Normalizes existing rows in place.
- Merges duplicate normalized names by re-pointing `event_hashtags` and `poll_hashtags` associations to the canonical row before removing the duplicate. Unknown foreign keys abort the transaction instead of cascading blindly.
- Adds the unique index on `normalized_name` and the default lookup index.
- Does not change RLS. The live `is_social_admin()` policies remain in force.

### 9.3 Verification workflow hardening

- `review_verification(...)` now raises `VERIFICATION_LIFEGROUP_ALREADY_LED` when approving a lifegroup application would overwrite a different primary leader or create a second active leader membership.
- The Verification Center maps that error to: “This lifegroup already has a different active leader. Resolve the existing leadership before approving this request.”
- Approval still updates `verification_submissions`, `lifegroups.leader_id`/`status`, and the applicant's `lifegroup_members` row in one transaction. Rejection still preserves the reason in `verification_reviews` and does not assign leadership.
- Unauthorized access remains blocked at three layers: the navigation hides the page for non-admins, the page checks `is_admin()`, and the RPC is `security definer` with an explicit `is_admin()` check and no `anon` execute grant.
- The `verification_requests` view remains admin-only.

### 9.4 `social_post_hashtags` removal

The legacy `public.social_post_hashtags` post-to-hashtag association table is
scheduled for removal because hashtag management now uses the canonical
`public.social_hashtags` catalog with `event_hashtags` and `poll_hashtags`.
The new migration `supabase/patch_2026_11_06_remove_social_post_hashtags.sql`
drops the legacy table and recreates `public.social_feed` without querying it.
The feed keeps the existing `hashtags` response field as an empty text array
for API shape compatibility. Existing social-post hashtag associations are
not migrated because this design no longer supports post hashtag links.

### 9.5 Mobile lifegroup applications

The mobile app exposes leader applications through
`public.leader_verification_requests`. The migration
`supabase/patch_2026_11_07_leader_verification_requests.sql` rebuilds the
admin `verification_requests` view from that object, maps `under review`,
`pending`, and unknown application states to `pending`, and preserves the
lifegroup ID as the review target. Approve/reject actions continue through
`review_verification(...)`, which updates the underlying lifegroup and
membership rows transactionally.

### 9.5 Files changed

| File | Change |
|---|---|
| `src/app/records/page.tsx` | Lifegroup Analytics rewritten against the six lifegroup objects. |
| `src/app/events-manager/page.tsx` | Hashtag validation, admin gating, immediate state update, diff-based relationship saves. |
| `src/app/verification/page.tsx` | Friendly `VERIFICATION_LIFEGROUP_ALREADY_LED` error. |
| `supabase/patch_2026_11_05_hashtag_normalization.sql` | New idempotent normalization/dedup migration. |
| `supabase/patch_2026_11_05_verification_lifegroup_and_post_review.sql` | Added active-leader overwrite guard. |
| `supabase/patch_2026_11_06_remove_social_post_hashtags.sql` | Removes the legacy social-post hashtag association table and updates `social_feed`. |
| `supabase/patch_2026_11_07_leader_verification_requests.sql` | Connects the admin queue to the mobile leader application view. |
| `supabase/patch_2026_11_08_fix_leader_review_status.sql` | Adds a dedicated lifegroup review RPC so mobile “under review” status cannot conflict with `lifegroups.status`. |
| `supabase/patch_2026_11_09_authoritative_lifegroup_review.sql` | Persists leader decisions to `lifegroups.approval_status`, reviewer metadata, and rejection reason. |
| `src/components/app-shell.tsx` | Existing admin-only Verification navigation guard (unchanged in this pass). |

### 9.6 Verification performed

- `npx tsc --noEmit` passes.
- `npm run lint` passes.
- `npm run build` passes.
- Live REST checks with the anon key:
  - `normalize_social_hashtag('#Youth')` → `youth`.
  - `normalize_social_hashtag('  #Sunday_Service  ')` → `sunday_service`.
  - `normalize_social_hashtag('bad-hashtag')` → `INVALID_HASHTAG_FORMAT`.
  - `social_hashtags` read returns the five existing default rows with populated `normalized_name`.
  - `verification_requests`, `lifegroups`, `lifegroup_attendance`, and `lifegroup_attendance_report` are not accessible to anon.
  - `review_verification` is not executable by anon (401).
  - `is_social_admin()` is callable but returns null for anon; `is_admin()` is permission-denied for anon.

### 9.7 Required live steps / blockers

1. Run `supabase/patch_2026_11_05_hashtag_normalization.sql` in the Supabase SQL Editor. It is idempotent and does not change RLS.
2. Re-run `supabase/patch_2026_11_05_verification_lifegroup_and_post_review.sql` so the new active-leader guard is installed.
3. Test the full Verification workflow as a real admin: pending list → approve → refresh → `lifegroups.leader_id` and `lifegroup_members.role/status`; then a second pending application for an already-led group → expect the friendly guard error. Test rejection with a reason and refresh.
4. Test hashtag creation as a social admin and as a non-admin, then refresh and select the new tag in an event and a poll.
5. No commit or push was performed. These changes remain in the working tree pending approval.
