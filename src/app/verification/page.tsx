"use client";

/* Runtime Supabase storage URLs are not known to next/image's static host configuration. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type Status = "pending" | "approved" | "rejected";
type Category = "all" | "social" | "user" | "profile_picture" | "lifegroup_leader";
type RequestCategory = Exclude<Category, "all">;

type ImagePreview = {
  id: string;
  path: string;
  url: string | null;
  status: Status;
  sortOrder: number;
};

type ProfileInfo = {
  name: string;
  avatarUrl: string | null;
  gender: string | null;
  birthday: string | null;
  network: string | null;
};

type RequestItem = {
  id: string;
  category: RequestCategory;
  component: "content" | "image" | "submission";
  title: string;
  detail: string;
  submittedAt: string;
  status: Status;
  profile: ProfileInfo | null;
  images: ImagePreview[];
  imageUrl: string | null;
  submissionData: Record<string, unknown> | null;
};

type ReviewDecision = "approved" | "rejected";
type ReviewDialog = {
  item: RequestItem;
  decision: ReviewDecision;
};

const labels: Record<RequestCategory, string> = {
  social: "Social Feed",
  user: "User Verification",
  profile_picture: "Profile Picture",
  lifegroup_leader: "Lifegroup Leader"
};

const SOCIAL_IMAGE_BUCKET = "social-post-images";
const AVATAR_BUCKET = "avatars";

function statusClass(status: Status) {
  return status === "approved"
    ? "bg-[#e7f4ee] text-[#245142]"
    : status === "rejected"
      ? "bg-[#fff0f1] text-[#8a3f46]"
      : "bg-[#fff6dd] text-[#7a5a17]";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown, fallback = "Not provided") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function profileName(profile: Record<string, unknown> | null, fallback = "Member") {
  if (!profile) return fallback;
  return [profile.first_name, profile.last_name]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ") || fallback;
}

function toProfile(row: Record<string, unknown> | null): ProfileInfo | null {
  if (!row) return null;
  const activeImage = textValue(row.profile_img_url, "");
  return {
    name: profileName(row),
    avatarUrl: activeImage ? (activeImage.startsWith("http") ? activeImage : supabase.storage.from(AVATAR_BUCKET).getPublicUrl(activeImage).data.publicUrl) : null,
    gender: typeof row.gender === "string" ? row.gender : null,
    birthday: typeof row.birthday === "string" ? row.birthday : null,
    network: typeof row.network === "string" ? row.network : null
  };
}

async function signedImageUrl(path: string, bucket = SOCIAL_IMAGE_BUCKET) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

function detailRows(data: Record<string, unknown> | null) {
  if (!data) return null;
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== "");
  if (!entries.length) return <p className="text-sm text-[#7a8b84]">No additional submitted details.</p>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">{key.replaceAll("_", " ")}</dt>
          <dd className="mt-1 break-words text-sm text-[#2f4d43]">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileSummary({ profile }: { profile: ProfileInfo | null }) {
  if (!profile) return <p className="text-sm text-[#7a8b84]">Profile details are unavailable.</p>;
  return (
    <div className="flex items-start gap-3">
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt={`${profile.name} profile`} className="h-12 w-12 rounded-full border border-[#c4d3ce] object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e7f0ec] text-sm font-semibold text-[#385b4f]">
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="font-semibold text-[#22332d]">{profile.name}</p>
        <p className="text-xs text-[#6b8178]">
          {[profile.gender, profile.birthday, profile.network].filter(Boolean).join(" · ") || "No additional profile information"}
        </p>
      </div>
    </div>
  );
}

function ImageGallery({ images, label }: { images: ImagePreview[]; label: string }) {
  if (!images.length) return <p className="text-sm text-[#7a8b84]">No attached image.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((image, index) => (
        <div key={image.id} className="overflow-hidden rounded-xl border border-[#c4d3ce] bg-[#f7faf8]">
          {image.url ? (
            <a href={image.url} target="_blank" rel="noreferrer" title="Open larger image">
              <img src={image.url} alt={`${label} image ${index + 1}`} className="h-48 w-full object-contain bg-[#e9f1ee]" />
            </a>
          ) : (
            <div className="flex h-48 items-center justify-center px-4 text-center text-xs text-[#7a8b84]">
              Image unavailable. Check the storage path and administrator storage policy.
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs text-[#6b8178]">Image {index + 1}</span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClass(image.status)}`}>{image.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function VerificationPage() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [category, setCategory] = useState<Category>("all");
  const [status, setStatus] = useState<Status | "all">("pending");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);
  const [reviewDialog, setReviewDialog] = useState<ReviewDialog | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadRequests = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setFeedback(supabaseEnvIssue ?? "Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const adminResult = await supabase.rpc("is_admin");
    if (adminResult.error || adminResult.data !== true) {
      setFeedback(adminResult.error?.message ?? "Administrator access is required.");
      setLoading(false);
      return;
    }

    const [postsResult, imagesResult, submissionsResult] = await Promise.all([
      supabase.from("social_posts").select("id, user_id, author_display_name, author_avatar_url, caption, created_at, status").order("created_at", { ascending: false }),
      supabase.from("social_post_images").select("id, post_id, storage_path, sort_order, created_at, status").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("verification_submissions").select("id, category, user_id, lifegroup_id, storage_path, submission_data, created_at, status").order("created_at", { ascending: false })
    ]);

    const error = postsResult.error ?? imagesResult.error ?? submissionsResult.error;
    if (error) {
      setFeedback(error.message);
      setLoading(false);
      return;
    }

    const posts = (postsResult.data ?? []) as Array<Record<string, unknown>>;
    const images = (imagesResult.data ?? []) as Array<Record<string, unknown>>;
    const submissions = (submissionsResult.data ?? []) as Array<Record<string, unknown>>;
    const userIds = [...new Set([...posts, ...submissions].map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];
    const profilesResult = userIds.length ? await supabase.from("profiles").select("id, first_name, last_name, gender, birthday, network, profile_img_url").in("id", userIds) : { data: [], error: null };
    const profileMap = new Map((profilesResult.data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return [String(record.id), toProfile(record)] as const;
    }));

    const imageRows = await Promise.all(images.map(async (image) => ({
      id: String(image.id),
      postId: String(image.post_id),
      path: String(image.storage_path),
      url: await signedImageUrl(String(image.storage_path)),
      status: (image.status as Status) || "pending",
      sortOrder: Number(image.sort_order ?? 0)
    })));

    const postItems: RequestItem[] = posts.flatMap((post) => {
      const postImages = imageRows
        .filter((image) => image.postId === String(post.id))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((image) => ({
          id: image.id,
          path: image.path,
          url: image.url,
          status: image.status,
          sortOrder: image.sortOrder
        }));
      const profile = profileMap.get(String(post.user_id)) ?? null;
      const authorName = profile?.name ?? textValue(post.author_display_name, "Member");
      const authorAvatar = profile?.avatarUrl ?? (typeof post.author_avatar_url === "string" ? post.author_avatar_url : null);
      return [
        {
          id: String(post.id),
          category: "social",
          component: "content",
          title: authorName,
          detail: textValue(post.caption, "No caption submitted"),
          submittedAt: String(post.created_at),
          status: (post.status as Status) || "pending",
          profile: profile ? { ...profile, avatarUrl: authorAvatar } : null,
          images: postImages,
          imageUrl: null,
          submissionData: null
        },
        ...postImages.map((image) => ({
          id: image.id,
          category: "social" as const,
          component: "image" as const,
          title: `${authorName} — image`,
          detail: textValue(post.caption, "Attached image"),
          submittedAt: String(post.created_at),
          status: image.status,
          profile: profile ? { ...profile, avatarUrl: authorAvatar } : null,
          images: [image],
          imageUrl: image.url,
          submissionData: null
        }))
      ];
    });

    const submissionItems: RequestItem[] = await Promise.all(submissions.map(async (submission) => {
      const data = asRecord(submission.submission_data);
      const profile = profileMap.get(String(submission.user_id)) ?? null;
      const imagePath = typeof submission.storage_path === "string" ? submission.storage_path : null;
      const storageBucket = submission.category === "profile_picture"
        ? AVATAR_BUCKET
        : typeof data.storage_bucket === "string" && data.storage_bucket.trim()
          ? data.storage_bucket
          : null;
      const imageUrl = imagePath && storageBucket ? await signedImageUrl(imagePath, storageBucket) : null;
      return {
        id: String(submission.id),
        category: submission.category as Exclude<Category, "all" | "social">,
        component: "submission",
        title: profile?.name ?? textValue(data.full_name, `${labels[submission.category as RequestCategory]} submission`),
        detail: textValue(data.details ?? data.description ?? data.reason, "Review the submitted information below."),
        submittedAt: String(submission.created_at),
        status: (submission.status as Status) || "pending",
        profile,
        images: imagePath ? [{ id: String(submission.id), path: imagePath, url: imageUrl, status: (submission.status as Status) || "pending", sortOrder: 0 }] : [],
        imageUrl,
        submissionData: data
      };
    }));

    setItems([...postItems, ...submissionItems]);
    setFeedback(profilesResult.error ? `Requests loaded, but some profile details are unavailable: ${profilesResult.error.message}` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial data loading synchronizes this client with Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRequests();
  }, [loadRequests]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory = category === "all" || item.category === category;
      const matchesStatus = status === "all" || item.status === status;
      const matchesSearch = !needle || `${item.title} ${item.detail} ${JSON.stringify(item.submissionData ?? {})}`.toLowerCase().includes(needle);
      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [category, items, search, status]);

  const openReviewDialog = (item: RequestItem, decision: ReviewDecision) => {
    setRejectionReason("");
    setReviewDialog({ item, decision });
  };

  const review = async () => {
    if (!reviewDialog) return;
    const { item, decision } = reviewDialog;
    const comments = decision === "rejected" ? rejectionReason.trim() : null;
    if (decision === "rejected" && !comments) {
      setNotification({ tone: "warning", message: "Please provide a reason before rejecting this request." });
      return;
    }

    setReviewDialog(null);
    setReviewing(item.id);
    const rpcCategory = item.component === "content" ? "social_post" : item.component === "image" ? "social_post_image" : item.category;
    const { error } = await supabase.rpc("review_verification", {
      p_target_id: item.id,
      p_category: rpcCategory,
      p_component: item.component,
      p_decision: decision,
      p_comments: comments
    });
    setReviewing(null);
    if (error) {
      setNotification({ tone: "error", message: `Could not ${decision === "approved" ? "approve" : "reject"} the request: ${error.message}` });
      return;
    }
    setNotification({
      tone: "success",
      message: `Verification request ${decision === "approved" ? "approved" : "rejected"} successfully.`
    });
    await loadRequests();
  };

  return (
    <div className="space-y-6 reveal">
      <section className="card bg-gradient-to-br from-[#f7fbf9] to-[#e9f1ee]">
        <h1 className="page-title font-[var(--font-heading)]">Verification Center</h1>
        <p className="page-subtitle">Review each submission independently. Approving one category never approves another.</p>
      </section>
      <section className="analytics-panel">
        <div className="flex flex-wrap gap-2">
          {(["all", "social", "user", "profile_picture", "lifegroup_leader"] as Category[]).map((value) => (
            <button key={value} type="button" className={category === value ? "btn-primary" : "btn-ghost"} onClick={() => setCategory(value)}>
              {value === "all" ? "All Requests" : labels[value as RequestCategory]}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_auto]">
          <label className="relative block">
            <span className="sr-only">Search submissions</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b8178]" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
            </svg>
            <input className="field-input pl-10" placeholder="Search member, post, or submission details" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select className="field-input" value={status} onChange={(event) => setStatus(event.target.value as Status | "all")}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <button type="button" className="btn-ghost" onClick={() => void loadRequests()}>Refresh</button>
        </div>
      </section>
      {feedback ? <p className="status-info" role="status">{feedback}</p> : null}
      {notification ? <AppNotification tone={notification.tone} message={notification.message} onDismiss={() => setNotification(null)} /> : null}
      {loading ? <p className="text-sm text-[#4f675e]">Loading verification requests...</p> : null}
      <section className="grid gap-4">
        {!loading && filteredItems.length === 0 ? <div className="analytics-panel text-sm text-[#5d7269]">No matching verification requests.</div> : null}
        {filteredItems.map((item) => (
          <article key={`${item.component}-${item.id}`} className="analytics-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6b8178]">{labels[item.category]} · {item.component}</p>
                <h2 className="mt-1 font-[var(--font-heading)] text-lg text-[#22332d]">{item.title}</h2>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#4f675e]">{item.detail}</p>
                <p className="mt-2 text-xs text-[#7a8b84]">{new Date(item.submittedAt).toLocaleString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${statusClass(item.status)}`}>{item.status}</span>
            </div>

            <details className="mt-4 rounded-xl border border-[#d6e1dd] bg-[#fbfdfc] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[#385b4f]">View complete submission details</summary>
              <div className="mt-4 space-y-4">
                {item.profile ? <ProfileSummary profile={item.profile} /> : null}
                {item.category === "social" ? <ImageGallery images={item.images} label={item.title} /> : null}
                {item.category === "profile_picture" ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#6b8178]">Submitted profile picture</p>
                    <ImageGallery images={item.images} label={item.title} />
                  </div>
                ) : null}
                {item.submissionData ? detailRows(item.submissionData) : null}
              </div>
            </details>

            {item.status === "pending" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={reviewing === item.id} onClick={() => openReviewDialog(item, "approved")}>{reviewing === item.id ? "Saving..." : "Approve"}</button>
                <button type="button" className="btn-ghost" disabled={reviewing === item.id} onClick={() => openReviewDialog(item, "rejected")}>Reject</button>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      {reviewDialog ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1b2a25]/45 px-4" role="presentation">
          <section className="w-full max-w-md rounded-2xl border border-[#c4d3ce] bg-[#fbfdfc] p-5 shadow-[0_22px_55px_rgba(31,52,44,0.24)] app-notification-enter" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6b8178]">Review request</p>
                <h2 id="review-dialog-title" className="mt-1 font-[var(--font-heading)] text-xl text-[#22332d]">
                  {reviewDialog.decision === "approved" ? "Approve request?" : "Reject request?"}
                </h2>
              </div>
              <button type="button" className="rounded-full px-2 text-2xl leading-none text-[#6b8178] hover:bg-[#e9f1ee]" onClick={() => setReviewDialog(null)} aria-label="Close review dialog">
                ×
              </button>
            </div>
            <p className="mt-3 text-sm text-[#4f675e]">
              {reviewDialog.decision === "approved"
                ? `Approve ${reviewDialog.item.title}'s ${reviewDialog.item.component} submission?`
                : `Reject ${reviewDialog.item.title}'s ${reviewDialog.item.component} submission?`}
            </p>
            {reviewDialog.decision === "rejected" ? (
              <label className="mt-4 block">
                <span className="field-label">Rejection reason</span>
                <textarea className="field-input min-h-24 resize-y" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain why this request is being rejected." autoFocus />
              </label>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setReviewDialog(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={() => void review()}>
                {reviewDialog.decision === "approved" ? "Approve Request" : "Reject Request"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
