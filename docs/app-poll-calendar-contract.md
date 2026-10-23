# App contract: polls and calendar

This document is the integration contract for the mobile app. The web app manages polls and calendar images; the app reads open polls, submits votes, and displays the current calendar image.

## 1. Database tables

### `event_suggestions`

Every poll is stored as one row per choice. There is no separate question row.

| Column | Meaning |
| --- | --- |
| `id` | Choice row id. Use this as `poll_id` in a submission. |
| `event_id` | Event the poll belongs to. |
| `suggestion_text` | The clean choice label, for example `ya` or `na`. Do not show encoded prefixes. |
| `suggestion_question_text` | The poll question, repeated on every choice row for that poll. Show this above the choices. |
| `poll_key` | Groups the choice rows that belong to the same poll. |
| `item_kind` | Always `choice` for poll rows. |
| `poll_status` | `open`, `closed`, or `archived` on every choice row in the poll. |
| `archived_at` | Set when one individual choice was removed. A poll that is closed or archived uses `poll_status`, not this column. |
| `sort_order` | Choice display order. |
| `created_at` | When the choice row was created. |
| `updated_at` | Last web-side edit time. |

Read the choices for an event:

```ts
const { data: rows, error } = await supabase
  .from("event_suggestions")
  .select(
    "id,event_id,suggestion_text,suggestion_question_text,poll_key,item_kind,poll_status,archived_at,sort_order"
  )
  .eq("event_id", eventId)
  .eq("item_kind", "choice")
  .is("archived_at", null)
  .order("sort_order", { ascending: true });
```

Group the rows by `poll_key`. Every row in a group has the same `suggestion_question_text`. Show a poll only when `poll_status = "open"`. Use `suggestion_question_text` as the heading (for example, in place of the generic “Choose your preferred suggestion” label) and `suggestion_text` as each radio option.

### `EventPoll_Submissions`

| Column | Meaning |
| --- | --- |
| `event_id` | Event id. |
| `poll_id` | The selected choice row id from `event_suggestions`. |
| `question_id` | The poll key (`event_suggestions.poll_key`). It is no longer a question row id. |
| `voter_key` | Stable user/device key. One vote per poll per key. |
| `created_at` | First vote time. |
| `updated_at` | Last vote-change time. |

`poll_id` is the selected choice. `question_id` is the poll identifier.

## 2. Submitting or changing a vote

The app can send the selected choice and let the database trigger fill in the poll key:

```ts
await supabase.from("EventPoll_Submissions").insert({
  event_id: eventId,
  poll_id: selectedChoiceRowId,
  voter_key: stableUserId
});
```

The trigger looks up the selected choice, sets `question_id` to its `poll_key`, and fills `voter_key` from `auth.uid()` when the app omits it.

If the app wants to perform an upsert, send the poll key explicitly:

```ts
await supabase.from("EventPoll_Submissions").upsert(
  {
    event_id: eventId,
    question_id: pollKey,
    poll_id: selectedChoiceRowId,
    voter_key: stableUserId
  },
  { onConflict: "question_id,voter_key" }
);
```

The unique index on `(question_id, voter_key)` allows one row per voter per poll. The upsert changes the existing vote instead of adding a second one. If `voter_key` is null, PostgreSQL allows duplicate anonymous rows; send a stable key.

### Recommended voter key

Use the app's authenticated Supabase user id:

```ts
const { data: { user } } = await supabase.auth.getUser();
const voterKey = user?.id;
```

If the app does not use Supabase Auth, use a UUID stored in secure device storage. That is weaker: clearing app data or reinstalling can create a new voter.

## 3. Reading results

Results are the number of submissions per selected choice. Count only choices that belong to the poll:

```ts
const { data: votes, error } = await supabase
  .from("EventPoll_Submissions")
  .select("poll_id,question_id,created_at")
  .eq("event_id", eventId)
  .eq("question_id", pollKey);

const counts = new Map<string, number>();
for (const vote of votes ?? []) {
  counts.set(vote.poll_id, (counts.get(vote.poll_id) ?? 0) + 1);
}

const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
```

Use the choices' `poll_status` to decide whether voting is still allowed. Results can remain visible after the poll is closed or archived.

## 4. Calendar image

The web app writes one current row to `public.calendar` and uploads the file to the public `calendar` storage bucket.

```ts
const { data: calendar, error } = await supabase
  .from("calendar")
  .select("calendar_img_url,updated_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const imageUrl = calendar?.calendar_img_url ?? null;
```

Display `imageUrl` with `BoxFit.contain` (Flutter) or `object-contain` (web) so the image keeps its aspect ratio. Handle three states:

- no URL: show an empty calendar placeholder;
- loading: show a skeleton/spinner;
- load error: show a retry or fallback message.

The bucket is public for reading. Upload, replace, and delete require an authenticated web user.

## 5. RLS checklist

Before testing the app, confirm in Supabase:

- the app role can `select` from `event_suggestions`;
- the app role can `select` the latest `calendar` row;
- the app role can `insert` and `update` `EventPoll_Submissions`;
- a voter can only update their own row (or the app is trusted to send its own `voter_key`);
- storage bucket `calendar` has public read and authenticated write.

The poll patches do **not** replace existing RLS policies on `event_suggestions` or `EventPoll_Submissions`. If the app cannot read/write, check those policies before changing code.

## 6. What the app needs from the web team

- `supabase/patch_2026_10_22_polls_calendar.sql` and `supabase/patch_2026_10_23_poll_question_text.sql` applied.
- The Supabase URL and anon key (never the service-role key).
- The app user identity source (Supabase Auth id or device UUID).
- A test event with one open poll and one calendar image.
