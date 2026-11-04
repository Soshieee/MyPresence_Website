"use client";

/* Runtime Supabase storage URLs are not known to next/image's static host configuration. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppNotification, { AppNotificationTone } from "@/components/app-notification";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type Status = "pending" | "approved" | "rejected";
type AccountType = "regular_user" | "web_admin";
type Category = "all" | "social" | "user" | "profile_picture" | "lifegroup_leader";
type RequestCategory = Exclude<Category, "all">;
type ReviewDecision = "approved" | "rejected";
type ReviewRpcCategory = "social_post" | "social_post_image" | RequestCategory;
type ReviewComponent = "post" | "content" | "image" | "submission";

type VerificationRequest = {
  request_id: string;
  category: RequestCategory;
  component: "content" | "submission";
  user_id: string;
  lifegroup_id: string | null;
  submitter_name: string;
  submitter_avatar_url: string | null;
  current_profile_img_url: string | null;
  detail: string | null;
  submitted_at: string;
  status: Status;
  overall_status: Status;
  image_count: number;
  pending_image_count: number;
  approved_image_count: number;
  rejected_image_count: number;
  storage_path: string | null;
  submission_data: Record<string, unknown> | null;
  lifegroup_name: string | null;
  current_leader_id: string | null;
  current_leader_name: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  account_type?: AccountType;
  submitter_gender: string | null;
  submitter_birthday: string | null;
  submitter_network: string | null;
};

type SocialImage = {
  id: string;
  post_id: string;
  storage_path: string;
  sort_order: number;
  status: Status;
  rejection_reason: string | null;
  reviewed_at: string | null;
  url: string | null;
};

type ReviewRow = {
  id: string;
  target_id: string;
  category: string;
  component: string | null;
  reviewer_id: string;
  decision: ReviewDecision;
  comments: string | null;
  reviewed_at: string;
};

type ReviewDialogState = {
  targetId: string;
  rpcCategory: ReviewRpcCategory;
  component: ReviewComponent;
  label: string;
  decision: ReviewDecision;
  scopeNote: string;
};

type Counts = {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
};

type Feedback = {
  tone: "info" | "error";
  message: string;
} | null;

const PAGE_SIZE = 3;
const SOCIAL_IMAGE_BUCKET = "social-post-images";
const AVATAR_BUCKET = "avatars";

const labels: Record<RequestCategory, string> = {
  social: "Social Feed Post",
  user: "User Verification",
  profile_picture: "Profile Picture",
  lifegroup_leader: "Lifegroup Leader"
};

const tabLabels: Record<Category, string> = {
  all: "All Requests",
  social: "Social Feed Posts",
  user: "User Verification",
  profile_picture: "Profile Pictures",
  lifegroup_leader: "Lifegroup Leaders"
};

function statusClass(status: Status) {
  return status === "approved"
    ? "bg-[#e7f4ee] text-[#245142]"
    : status === "rejected"
      ? "bg-[#fff0f1] text-[#8a3f46]"
      : "bg-[#fff6dd] text-[#7a5a17]";
}

function statusLabel(status: Status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function accountTypeLabel(accountType: AccountType) {
  return accountType === "web_admin" ? "Web Admin Account" : "Regular User Account";
}

function formatDate(value: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveProfileImage(value: string | null) {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(value).data.publicUrl;
}

async function signedImageUrl(path: string, bucket: string) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function resolveAvatarUrl(value: string | null) {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  const signed = await signedImageUrl(value, AVATAR_BUCKET);
  return signed ?? supabase.storage.from(AVATAR_BUCKET).getPublicUrl(value).data.publicUrl;
}

function friendlyLoadError(message: string) {
  if (
    message.includes("PGRST205") ||
    message.includes("PGRST202") ||
    /relation .*verification_requests.* does not exist/i.test(message) ||
    /relation .*app_user_verification.* does not exist/i.test(message) ||
    /function .*list_user_verifications_v2.* does not exist/i.test(message)
  ) {
    return "The verification database update has not been applied. Run the latest verification migrations in the Supabase SQL Editor, then refresh.";
  }
  return message;
}

function friendlyReviewError(message: string) {
  if (message.includes("VERIFICATION_ALREADY_REVIEWED")) {
    return "This item was already reviewed. Refresh to see the latest status.";
  }
  if (message.includes("VERIFICATION_SELF_REVIEW_FORBIDDEN")) {
    return "You cannot review your own submission.";
  }
  if (message.includes("VERIFICATION_REJECTION_REASON_REQUIRED")) {
    return "A rejection reason is required.";
  }
  if (message.includes("VERIFICATION_EMAIL_NOT_CONFIRMED")) {
    return "This Web Admin Account must confirm its email before it can be approved.";
  }
  if (message.includes("VERIFICATION_ADMIN_REQUIRED")) {
    return "Administrator access is required.";
  }
  if (message.includes("VERIFICATION_TARGET_NOT_FOUND")) {
    return "This request no longer exists. Refresh the queue.";
  }
  if (message.includes("USER_VERIFICATION_DUPLICATE")) {
    return "This user has multiple verification records. Resolve the duplicate records before reviewing this request.";
  }
  if (message.includes("VERIFICATION_CATEGORY_INVALID") || message.includes("VERIFICATION_DECISION_INVALID")) {
    return "This review action is not supported.";
  }
  if (message.includes("VERIFICATION_PROFILE_IMAGE_REQUIRED")) {
    return "This profile picture submission has no image to activate.";
  }
  if (message.includes("VERIFICATION_LIFEGROUP_REQUIRED")) {
    return "This lifegroup leader submission is missing a lifegroup.";
  }
  if (message.includes("VERIFICATION_LIFEGROUP_NOT_FOUND")) {
    return "The lifegroup no longer exists.";
  }
  if (message.includes("VERIFICATION_LIFEGROUP_ALREADY_LED")) {
    return "This lifegroup already has a different active leader. Resolve the existing leadership before approving this request.";
  }
  if (message.includes("VERIFICATION_PROFILE_NOT_FOUND")) {
    return "The member profile no longer exists.";
  }
  return message;
}

function reviewerLabel(reviewerId: string, reviewerNames: Record<string, string>) {
  return reviewerNames[reviewerId] ?? "Administrator";
}

function StatusBadge({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClass(status)} ${className}`}>
      {statusLabel(status)}
    </span>
  );
}

function ProfileSummary({ request, avatarUrl }: { request: VerificationRequest; avatarUrl: string | null }) {
  const avatar = avatarUrl;
  return (
    <div className="flex items-start gap-3">
      {avatar ? (
        <img
          src={avatar}
          alt={`${request.submitter_name} profile`}
          className="h-12 w-12 rounded-full border border-[#c4d3ce] object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e7f0ec] text-sm font-semibold text-[#385b4f]">
          {request.submitter_name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="font-semibold text-[#22332d]">{request.submitter_name}</p>
        <p className="text-xs text-[#6b8178]">
          {[request.submitter_gender, request.submitter_birthday, request.submitter_network]
            .filter(Boolean)
            .join(" · ") || "No additional profile information"}
        </p>
      </div>
    </div>
  );
}

function ReviewHistory({
  rows,
  reviewerNames
}: {
  rows: ReviewRow[];
  reviewerNames: Record<string, string>;
}) {
  if (!rows.length) {
    return <p className="text-sm text-[#7a8b84]">No review history yet.</p>;
  }

  return (
    <ol className="space-y-2">
      {rows.map((review) => (
        <li key={review.id} className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#22332d]">
              {reviewerLabel(review.reviewer_id, reviewerNames)}
            </p>
            <StatusBadge status={review.decision} />
          </div>
          <p className="mt-1 text-[11px] text-[#71847c]">
            {review.category.replaceAll("_", " ")} · {review.component ?? "submission"} · {formatDate(review.reviewed_at)}
          </p>
          {review.comments ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#4f675e]">{review.comments}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function DetailRows({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== "");
  if (!entries.length) {
    return <p className="text-sm text-[#7a8b84]">No additional submitted details.</p>;
  }

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">
            {key.replaceAll("_", " ")}
          </dt>
          <dd className="mt-1 break-words text-sm text-[#2f4d43]">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ImageCard({
  image,
  index,
  request
}: {
  image: SocialImage;
  index: number;
  request: VerificationRequest;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#c4d3ce] bg-[#f7faf8]">
      {image.url ? (
        <a href={image.url} target="_blank" rel="noreferrer" title="Open larger image">
          <img
            src={image.url}
            alt={`${request.submitter_name} image ${index + 1}`}
            className="h-48 w-full bg-[#e9f1ee] object-contain"
          />
        </a>
      ) : (
        <div className="flex h-48 items-center justify-center px-4 text-center text-xs text-[#7a8b84]">
          Image unavailable. Check the storage path and administrator storage policy.
        </div>
      )}
      <div className="space-y-2 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#6b8178]">Image {index + 1}</span>
          <StatusBadge status={image.status} />
        </div>
        {image.rejection_reason ? (
          <p className="text-xs text-[#8a3f46]">Reason: {image.rejection_reason}</p>
        ) : null}
      </div>
    </div>
  );
}

function PictureComparison({
  request,
  submittedUrl,
  currentUrl
}: {
  request: VerificationRequest;
  submittedUrl: string | null;
  currentUrl: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">
          Current approved picture
        </p>
        {currentUrl ? (
          <img
            src={currentUrl}
            alt={`${request.submitter_name} current profile`}
            className="mt-2 h-56 w-full rounded-lg bg-[#e9f1ee] object-contain"
          />
        ) : (
          <div className="mt-2 flex h-56 items-center justify-center rounded-lg bg-[#e9f1ee] px-4 text-center text-xs text-[#7a8b84]">
            No current approved picture.
          </div>
        )}
      </div>
      <div className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">
            Submitted picture
          </p>
          <StatusBadge status={request.status} />
        </div>
        {submittedUrl ? (
          <img
            src={submittedUrl}
            alt={`${request.submitter_name} submitted profile`}
            className="mt-2 h-56 w-full rounded-lg bg-[#e9f1ee] object-contain"
          />
        ) : (
          <div className="mt-2 flex h-56 items-center justify-center rounded-lg bg-[#e9f1ee] px-4 text-center text-xs text-[#7a8b84]">
            Submitted picture unavailable. Check the storage path and administrator storage policy.
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewCards({ counts }: { counts: Counts }) {
  const cards: Array<{ label: string; value: number; accent: string }> = [
    { label: "Pending", value: counts.pending, accent: "border-t-[#d9b45c]" },
    { label: "Approved", value: counts.approved, accent: "border-t-[#7fb39f]" },
    { label: "Rejected", value: counts.rejected, accent: "border-t-[#cf8f95]" },
    { label: "Total", value: counts.total, accent: "border-t-[#8ca7a0]" }
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`analytics-card border-t-4 ${card.accent}`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b8178]">{card.label}</p>
          <p className="mt-2 font-[var(--font-heading)] text-3xl text-[#22332d]">{card.value}</p>
        </div>
      ))}
    </section>
  );
}

function Pagination({
  page,
  total,
  onPageChange
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-[#6b8178]">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="rounded-full border border-[#c4d3ce] bg-[#f7faf8] px-3 py-1.5 text-xs font-semibold text-[#35554a]">
          Page {page + 1}
        </span>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={end >= total}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ReviewDialogModal({
  dialog,
  rejectionReason,
  onRejectionReasonChange,
  busy,
  onCancel,
  onConfirm
}: {
  dialog: ReviewDialogState;
  rejectionReason: string;
  onRejectionReasonChange: (value: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1b2a25]/45 px-4" role="presentation">
      <section
        className="w-full max-w-md rounded-2xl border border-[#c4d3ce] bg-[#fbfdfc] p-5 shadow-[0_22px_55px_rgba(31,52,44,0.24)] app-notification-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-dialog-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6b8178]">Review request</p>
            <h2 id="review-dialog-title" className="mt-1 font-[var(--font-heading)] text-xl text-[#22332d]">
              {dialog.decision === "approved" ? "Approve request?" : "Reject request?"}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-full px-2 text-2xl leading-none text-[#6b8178] hover:bg-[#e9f1ee]"
            onClick={onCancel}
            aria-label="Close review dialog"
          >
            ×
          </button>
        </div>
        <p className="mt-3 text-sm font-semibold text-[#2f4d43]">{dialog.label}</p>
        <p className="mt-2 text-sm text-[#4f675e]">{dialog.scopeNote}</p>
        {dialog.decision === "rejected" ? (
          <label className="mt-4 block">
            <span className="field-label">Rejection reason</span>
            <textarea
              className="field-input min-h-24 resize-y"
              value={rejectionReason}
              onChange={(event) => onRejectionReasonChange(event.target.value)}
              placeholder="Explain why this request is being rejected."
              autoFocus
            />
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Saving..." : dialog.decision === "approved" ? "Approve Request" : "Reject Request"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ReviewActions({
  targetId,
  rpcCategory,
  component,
  label,
  status,
  reviewingKey,
  onReview
}: {
  targetId: string;
  rpcCategory: ReviewRpcCategory;
  component: ReviewComponent;
  label: string;
  status: Status;
  reviewingKey: string | null;
  onReview: (
    targetId: string,
    rpcCategory: ReviewRpcCategory,
    component: ReviewComponent,
    label: string,
    decision: ReviewDecision
  ) => void;
}) {
  if (status !== "pending") return null;

  const key = `${component}-${targetId}`;
  const busy = reviewingKey === key;

  return (
    <div className="flex flex-wrap gap-2 border-t border-[#d6e1dd] pt-3">
      <button
        type="button"
        className="btn-primary px-4 py-2 text-xs"
        disabled={busy}
        onClick={() => onReview(targetId, rpcCategory, component, label, "approved")}
      >
        {busy ? "Saving..." : "Approve"}
      </button>
      <button
        type="button"
        className="btn-ghost px-4 py-2 text-xs"
        disabled={busy}
        onClick={() => onReview(targetId, rpcCategory, component, label, "rejected")}
      >
        Reject
      </button>
    </div>
  );
}

function RequestCard({
  request,
  images,
  submissionUrl,
  submitterAvatarUrl,
  currentProfileUrl,
  history,
  reviewerNames,
  reviewingKey,
  onReview
}: {
  request: VerificationRequest;
  images: SocialImage[];
  submissionUrl: string | null;
  submitterAvatarUrl: string | null;
  currentProfileUrl: string | null;
  history: ReviewRow[];
  reviewerNames: Record<string, string>;
  reviewingKey: string | null;
  onReview: (
    targetId: string,
    rpcCategory: ReviewRpcCategory,
    component: ReviewComponent,
    label: string,
    decision: ReviewDecision
  ) => void;
}) {
  const contentLabel = `${request.submitter_name}'s ${labels[request.category].toLowerCase()}`;

  return (
    <article className="rounded-2xl border border-[#c4d3ce] bg-white/80 p-4 shadow-[0_10px_26px_rgba(56,91,79,0.07)] md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6b8178]">
            {labels[request.category]}
          </p>
          <p className="mt-1 text-xs text-[#7a8b84]">
            Submitted {formatDate(request.submitted_at)} · Ref {request.request_id.slice(0, 8)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.overall_status} />
          {request.category === "user" && request.account_type ? (
            <span className="rounded-full border border-[#b8c9c2] bg-[#f3f8f5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#35554a]">
              {accountTypeLabel(request.account_type)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <ProfileSummary request={request} avatarUrl={submitterAvatarUrl} />
      </div>

      {request.category === "social" ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">Post content</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#2f4d43]">
              {request.detail?.trim() || "No caption provided."}
            </p>
            {request.rejection_reason ? (
              <p className="mt-2 rounded-lg bg-[#fff0f1] px-3 py-2 text-xs text-[#8a3f46]">
                Rejection reason: {request.rejection_reason}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#5d726e]">
              <span className="rounded-full bg-[#e9f1ee] px-2.5 py-1">Images: {request.image_count}</span>
              <span className="rounded-full bg-[#e7f4ee] px-2.5 py-1 text-[#245142]">
                Approved: {request.approved_image_count}
              </span>
              <span className="rounded-full bg-[#fff6dd] px-2.5 py-1 text-[#7a5a17]">
                Pending: {request.pending_image_count}
              </span>
              <span className="rounded-full bg-[#fff0f1] px-2.5 py-1 text-[#8a3f46]">
                Rejected: {request.rejected_image_count}
              </span>
            </div>
          </div>

          {images.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {images.map((image, index) => (
                <ImageCard key={image.id} image={image} index={index} request={request} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-[#c4d3ce] bg-[#f7faf8] px-3 py-3 text-sm text-[#5d726e]">
              No images attached. Approving the post publishes the content.
            </p>
          )}

          {request.overall_status === "pending" && request.status === "approved" ? (
            <p className="status-info">
              This post is partially reviewed. Approve the whole post to publish it, or reject it with a reason.
            </p>
          ) : null}

          <ReviewActions
            targetId={request.request_id}
            rpcCategory="social_post"
            component="post"
            label={`${request.submitter_name}'s social post`}
            status={request.overall_status}
            reviewingKey={reviewingKey}
            onReview={onReview}
          />
        </div>
      ) : request.category === "profile_picture" ? (
        <div className="mt-4 space-y-4">
          <PictureComparison request={request} submittedUrl={submissionUrl} currentUrl={currentProfileUrl} />
          <DetailRows data={request.submission_data} />
          {request.rejection_reason ? (
            <p className="rounded-xl bg-[#fff0f1] px-3 py-2 text-xs text-[#8a3f46]">
              Rejection reason: {request.rejection_reason}
            </p>
          ) : null}
          <ReviewActions
            targetId={request.request_id}
            rpcCategory="profile_picture"
            component="submission"
            label={contentLabel}
            status={request.status}
            reviewingKey={reviewingKey}
            onReview={onReview}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {request.category === "lifegroup_leader" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">Lifegroup</p>
                <p className="mt-1 text-sm font-semibold text-[#2f4d43]">
                  {request.lifegroup_name ?? "Lifegroup not found"}
                </p>
              </div>
              <div className="rounded-xl border border-[#d6e1dd] bg-[#f7faf8] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71847c]">
                  Current primary leader
                </p>
                <p className="mt-1 text-sm font-semibold text-[#2f4d43]">
                  {request.current_leader_name ?? "Unassigned"}
                </p>
              </div>
            </div>
          ) : null}
          {submissionUrl ? (
            <a
              href={submissionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-xs font-semibold text-[#385b4f] underline decoration-[#9fb8af] underline-offset-4"
            >
              Open submitted supporting file
            </a>
          ) : null}
          <DetailRows data={request.submission_data} />
          {request.rejection_reason ? (
            <p className="rounded-xl bg-[#fff0f1] px-3 py-2 text-xs text-[#8a3f46]">
              Rejection reason: {request.rejection_reason}
            </p>
          ) : null}
          <ReviewActions
            targetId={request.request_id}
            rpcCategory={request.category}
            component="submission"
            label={contentLabel}
            status={request.status}
            reviewingKey={reviewingKey}
            onReview={onReview}
          />
        </div>
      )}

      <details className="mt-4 rounded-xl border border-[#d6e1dd] bg-[#fbfdfc] px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.08em] text-[#486056]">
          Review history ({history.length})
        </summary>
        <div className="mt-3">
          <ReviewHistory rows={history} reviewerNames={reviewerNames} />
        </div>
      </details>
    </article>
  );
}

export default function VerificationPage() {
  const [adminState, setAdminState] = useState<"checking" | "allowed" | "denied">(() =>
    hasSupabaseEnv ? "checking" : "denied"
  );
  const [adminMessage, setAdminMessage] = useState(() =>
    hasSupabaseEnv ? "" : supabaseEnvIssue ?? "Supabase is not configured."
  );
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [socialImages, setSocialImages] = useState<Record<string, SocialImage[]>>({});
  const [submissionImageUrls, setSubmissionImageUrls] = useState<Record<string, string | null>>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(hasSupabaseEnv);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [notification, setNotification] = useState<{ tone: AppNotificationTone; message: string } | null>(null);
  const [category, setCategory] = useState<Category>("all");
  const [status, setStatus] = useState<Status | "all">("pending");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [accountType, setAccountType] = useState<AccountType | "all">("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);

  const categoryTabs = useMemo(() => Object.keys(tabLabels) as Category[], []);

  useEffect(() => {
    if (!hasSupabaseEnv) return;

    let active = true;
    const checkAdmin = async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (!active) return;
      if (error || data !== true) {
        setAdminState("denied");
        setAdminMessage(error?.message ?? "Administrator access is required.");
        setLoading(false);
        return;
      }
      setAdminState("allowed");
    };

    void checkAdmin();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const loadCounts = useCallback(async () => {
    if (adminState !== "allowed") return;

    const [pendingResult, approvedResult, rejectedResult, totalResult, userPendingResult, userApprovedResult, userRejectedResult, userTotalResult] = await Promise.all([
      supabase.from("verification_requests").select("*", { count: "exact", head: true }).neq("category", "user").eq("overall_status", "pending"),
      supabase.from("verification_requests").select("*", { count: "exact", head: true }).neq("category", "user").eq("overall_status", "approved"),
      supabase.from("verification_requests").select("*", { count: "exact", head: true }).neq("category", "user").eq("overall_status", "rejected"),
      supabase.from("verification_requests").select("*", { count: "exact", head: true }).neq("category", "user"),
      supabase.rpc("count_user_verifications", { p_status: "pending" }),
      supabase.rpc("count_user_verifications", { p_status: "approved" }),
      supabase.rpc("count_user_verifications", { p_status: "rejected" }),
      supabase.rpc("count_user_verifications", { p_status: null })
    ]);

    const error =
      pendingResult.error ??
      approvedResult.error ??
      rejectedResult.error ??
      totalResult.error ??
      userPendingResult.error ??
      userApprovedResult.error ??
      userRejectedResult.error ??
      userTotalResult.error;
    if (error) {
      setFeedback({ tone: "error", message: friendlyLoadError(error.message) });
      return;
    }

    setCounts({
      pending: (pendingResult.count ?? 0) + (userPendingResult.data ?? 0),
      approved: (approvedResult.count ?? 0) + (userApprovedResult.data ?? 0),
      rejected: (rejectedResult.count ?? 0) + (userRejectedResult.data ?? 0),
      total: (totalResult.count ?? 0) + (userTotalResult.data ?? 0)
    });
  }, [adminState]);

  const loadRequests = useCallback(async () => {
    if (adminState !== "allowed") return;

    setLoading(true);
    setFeedback(null);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const safeSearch = search.replace(/[%,().]/g, " ").replace(/\s+/g, " ").trim();
    let data: unknown[] | null = null;
    let error: { message: string } | null = null;
    let count: number | null = null;

    if (category === "user") {
      const userResult = await supabase.rpc("list_user_verifications_v2", {
        p_status: status === "all" ? null : status,
        p_search: safeSearch || null,
        p_offset: from,
        p_limit: PAGE_SIZE,
        p_sort_asc: sortAsc,
        p_account_type: accountType === "all" ? null : accountType
      });
      data = userResult.data;
      error = userResult.error;
      count = userResult.data?.[0]?.total_count ?? 0;
    } else {
      let query = supabase
        .from("verification_requests")
        .select("*", { count: "exact" })
        .neq("category", "user")
        .order("submitted_at", { ascending: sortAsc })
        .range(from, to);

      if (category !== "all") query = query.eq("category", category);
      if (status !== "all") query = query.eq("overall_status", status);
      if (safeSearch) {
        query = query.or(
          [
            `submitter_name.ilike.%${safeSearch}%`,
            `detail.ilike.%${safeSearch}%`,
            `lifegroup_name.ilike.%${safeSearch}%`,
            `current_leader_name.ilike.%${safeSearch}%`
          ].join(",")
        );
      }

      const result = await query;
      data = result.data;
      error = result.error;
      count = result.count;
    }

    if (error) {
      setRequests([]);
      setTotal(0);
      setFeedback({ tone: "error", message: friendlyLoadError(error.message) });
      setLoading(false);
      return;
    }

    let rows = (data ?? []) as VerificationRequest[];
    if (category === "user") {
      const userRows = (data ?? []) as Array<Record<string, unknown>>;
      const userIds = userRows.map((row) => String(row.user_id ?? "")).filter(Boolean);
      const profilesResult = userIds.length
        ? await supabase.from("profiles").select("id, first_name, last_name, profile_img_url, gender, birthday, network").in("id", userIds)
        : { data: [], error: null };
      if (profilesResult.error) {
        setRequests([]);
        setTotal(0);
        setFeedback({ tone: "error", message: friendlyLoadError(profilesResult.error.message) });
        setLoading(false);
        return;
      }

      const profiles = new Map(
        (profilesResult.data ?? []).map((profile) => [String(profile.id), profile as Record<string, unknown>])
      );
      rows = userRows.map((row) => {
        const userId = String(row.user_id);
        const profile = profiles.get(userId) ?? {};
        const firstName = String(row.first_name ?? profile.first_name ?? "").trim();
        const lastName = String(row.last_name ?? profile.last_name ?? "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || String(row.email ?? "User");
        const statusValue = row.status === "approved" || row.status === "rejected" ? row.status : "pending";
        return {
          request_id: userId,
          category: "user",
          component: "submission",
          user_id: userId,
          lifegroup_id: null,
          submitter_name: fullName,
          submitter_avatar_url: typeof profile.profile_img_url === "string" ? profile.profile_img_url : null,
          current_profile_img_url: typeof profile.profile_img_url === "string" ? profile.profile_img_url : null,
          detail: typeof row.email === "string" ? row.email : null,
          submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : "",
          status: statusValue,
          overall_status: statusValue,
          image_count: 0,
          pending_image_count: 0,
          approved_image_count: 0,
          rejected_image_count: 0,
          storage_path: null,
          submission_data: {
            email: row.email,
            account_created_at: row.account_created_at,
            first_name: row.first_name,
            last_name: row.last_name,
            gender: profile.gender,
            birthday: profile.birthday,
            network: profile.network
          },
          lifegroup_name: null,
          current_leader_id: null,
          current_leader_name: null,
          rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null,
          reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
          account_type: row.account_type === "web_admin" ? "web_admin" : "regular_user",
          submitter_gender: typeof profile.gender === "string" ? profile.gender : null,
          submitter_birthday: typeof profile.birthday === "string" ? profile.birthday : null,
          submitter_network: typeof profile.network === "string" ? profile.network : null
        };
      });
    }
    const nextTotal = count ?? 0;

    if (!rows.length && page > 0) {
      if (nextTotal > 0) {
        setPage(page - 1);
      } else {
        setPage(0);
      }
      return;
    }

    setRequests(rows);
    setTotal(nextTotal);

    const socialIds = rows
      .filter((row) => row.category === "social")
      .map((row) => row.request_id);

    let imagesResult: { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
    if (socialIds.length) {
      imagesResult = await supabase
        .from("social_post_images")
        .select("id, post_id, storage_path, sort_order, status, rejection_reason, reviewed_at, created_at")
        .in("post_id", socialIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    } else {
      imagesResult = { data: [], error: null };
    }

    if (imagesResult.error) {
      setFeedback({ tone: "error", message: friendlyLoadError(imagesResult.error.message) });
      setLoading(false);
      return;
    }

    const imageRows = await Promise.all(
      (imagesResult.data ?? []).map(async (image) => {
        const path = String(image.storage_path ?? "");
        return {
          id: String(image.id),
          post_id: String(image.post_id),
          storage_path: path,
          sort_order: Number(image.sort_order ?? 0),
          status: (image.status as Status) || "pending",
          rejection_reason: typeof image.rejection_reason === "string" ? image.rejection_reason : null,
          reviewed_at: typeof image.reviewed_at === "string" ? image.reviewed_at : null,
          url: await signedImageUrl(path, SOCIAL_IMAGE_BUCKET)
        } satisfies SocialImage;
      })
    );

    const imagesByPost: Record<string, SocialImage[]> = {};
    for (const image of imageRows) {
      imagesByPost[image.post_id] = [...(imagesByPost[image.post_id] ?? []), image];
    }
    setSocialImages(imagesByPost);

    const submissionUrls: Record<string, string | null> = {};
    await Promise.all(
      rows
        .filter((row) => Boolean(row.storage_path))
        .map(async (row) => {
          const path = row.storage_path;
          if (!path) return;
          const data = asRecord(row.submission_data);
          const bucket = row.category === "profile_picture"
            ? AVATAR_BUCKET
            : typeof data.storage_bucket === "string" && data.storage_bucket.trim()
              ? data.storage_bucket
              : null;
          submissionUrls[row.request_id] = bucket ? await signedImageUrl(path, bucket) : null;
        })
    );
    setSubmissionImageUrls(submissionUrls);

    const avatarPaths = [
      ...new Set(
        rows
          .flatMap((row) => [row.submitter_avatar_url, row.current_profile_img_url])
          .filter((value): value is string => Boolean(value))
      )
    ];
    const avatarEntries = await Promise.all(
      avatarPaths.map(async (path) => [path, await resolveAvatarUrl(path)] as const)
    );
    setAvatarUrls(Object.fromEntries(avatarEntries));

    const targetIds = [
      ...rows.map((row) => row.request_id),
      ...imageRows.map((image) => image.id)
    ];

    if (targetIds.length) {
      const reviewsResult = await supabase
        .from("verification_reviews")
        .select("id, target_id, category, component, reviewer_id, decision, comments, reviewed_at")
        .in("target_id", targetIds)
        .order("reviewed_at", { ascending: false });

      if (reviewsResult.error) {
        setFeedback({
          tone: "info",
          message: `Requests loaded, but review history is unavailable: ${reviewsResult.error.message}`
        });
        setReviewRows([]);
        setReviewerNames({});
      } else {
        const reviews = (reviewsResult.data ?? []) as ReviewRow[];
        setReviewRows(reviews);
        const reviewerIds = [...new Set(reviews.map((review) => review.reviewer_id))];
        if (reviewerIds.length) {
          const reviewersResult = await supabase
            .from("profiles")
            .select("id, first_name, last_name")
            .in("id", reviewerIds);
          if (!reviewersResult.error) {
            const names: Record<string, string> = {};
            for (const reviewer of reviewersResult.data ?? []) {
              const record = reviewer as Record<string, unknown>;
              const name = [record.first_name, record.last_name]
                .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
                .join(" ");
              names[String(record.id)] = name || "Administrator";
            }
            setReviewerNames(names);
          } else {
            setReviewerNames({});
          }
        } else {
          setReviewerNames({});
        }
      }
    } else {
      setReviewRows([]);
      setReviewerNames({});
    }

    setLoading(false);
  }, [accountType, adminState, category, page, search, sortAsc, status]);

  useEffect(() => {
    if (adminState !== "allowed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRequests();
  }, [adminState, loadRequests]);

  useEffect(() => {
    if (adminState !== "allowed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCounts();
  }, [adminState, loadCounts]);

  const changeCategory = (next: Category) => {
    setCategory(next);
    setPage(0);
    setFeedback(null);
  };

  const changeStatus = (next: Status | "all") => {
    setStatus(next);
    setPage(0);
  };

  const changeSort = (nextAsc: boolean) => {
    setSortAsc(nextAsc);
    setPage(0);
  };

  const changeAccountType = (next: AccountType | "all") => {
    setAccountType(next);
    setPage(0);
  };

  const refresh = () => {
    void loadRequests();
    void loadCounts();
  };

  const openReview = (
    targetId: string,
    rpcCategory: ReviewRpcCategory,
    component: ReviewComponent,
    label: string,
    decision: ReviewDecision
  ) => {
    const scopeNote = component === "post"
      ? "The post content and every attached image will be reviewed together. Approving publishes the post; rejecting hides it."
      : component === "content"
        ? "Only the post content will be reviewed. Images are reviewed independently."
        : component === "image"
          ? "Only this image will be reviewed. The post publishes only when the content and every image are approved."
          : rpcCategory === "profile_picture"
            ? "Only this profile picture submission will be reviewed. Rejecting keeps the current approved picture."
            : rpcCategory === "lifegroup_leader"
              ? "Only this lifegroup leader application will be reviewed. Existing membership records are preserved."
              : "Only this user verification submission will be reviewed. Other categories are unaffected.";

    setRejectionReason("");
    setReviewDialog({ targetId, rpcCategory, component, label, decision, scopeNote });
  };

  const review = async () => {
    if (!reviewDialog) return;

    const comments = reviewDialog.decision === "rejected" ? rejectionReason.trim() : null;
    if (reviewDialog.decision === "rejected" && !comments) {
      setNotification({ tone: "warning", message: "Please provide a reason before rejecting this request." });
      return;
    }

    const key = `${reviewDialog.component}-${reviewDialog.targetId}`;
    setReviewingKey(key);

    const { error } = reviewDialog.rpcCategory === "lifegroup_leader"
      ? await supabase.rpc("review_lifegroup_verification", {
        p_target_id: reviewDialog.targetId,
        p_decision: reviewDialog.decision,
        p_comments: comments
      })
      : reviewDialog.rpcCategory === "user"
        ? await supabase.rpc("review_user_verification", {
          p_user_id: reviewDialog.targetId,
          p_decision: reviewDialog.decision,
          p_comments: comments
        })
      : await supabase.rpc("review_verification", {
        p_target_id: reviewDialog.targetId,
        p_category: reviewDialog.rpcCategory,
        p_component: reviewDialog.component,
        p_decision: reviewDialog.decision,
        p_comments: comments
      });

    setReviewingKey(null);

    if (error) {
      setNotification({ tone: "error", message: friendlyReviewError(error.message) });
      return;
    }

    setReviewDialog(null);
    setNotification({
      tone: "success",
      message: reviewDialog.rpcCategory === "lifegroup_leader"
        ? `Lifegroup leader application ${reviewDialog.decision === "approved" ? "approved" : "rejected"} successfully.`
        : `${reviewDialog.label} ${reviewDialog.decision === "approved" ? "approved" : "rejected"}.`
    });
    await Promise.all([loadRequests(), loadCounts()]);
  };

  const historyFor = (request: VerificationRequest) => {
    const imageIds = new Set((socialImages[request.request_id] ?? []).map((image) => image.id));
    return reviewRows.filter(
      (review) => review.target_id === request.request_id || imageIds.has(review.target_id)
    );
  };

  return (
    <div className="reveal space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#5d7b70]">Administration</p>
          <h1 className="page-title mt-1">Verification Center</h1>
        </div>
        {adminState === "allowed" ? (
          <button type="button" className="btn-ghost" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Queue"}
          </button>
        ) : null}
      </header>

      {adminState === "checking" ? (
        <section className="card text-center">
          <p className="font-[var(--font-heading)] text-xl text-[#22332d]">Checking administrator access...</p>
          <p className="mt-2 text-sm text-[#5d7269]">Verification tools are restricted to authorized administrators.</p>
        </section>
      ) : null}

      {adminState === "denied" ? (
        <section className="card">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a3f46]">Access denied</p>
          <h2 className="mt-1 font-[var(--font-heading)] text-2xl text-[#22332d]">Administrator access required</h2>
          <p className="mt-2 text-sm text-[#5d7269]">
            {adminMessage || "Your account does not have permission to open the Verification Center."}
          </p>
          <Link href="/" className="btn-ghost mt-4">
            Return Home
          </Link>
        </section>
      ) : null}

      {adminState === "allowed" ? (
        <>
          <OverviewCards counts={counts} />

          <section className="analytics-panel space-y-4">
            <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {categoryTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={category === tab}
                  className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    category === tab
                      ? "border-[#385b4f] bg-[#385b4f] text-white"
                      : "border-[#b8c9c2] bg-white/80 text-[#35554a] hover:bg-[#eef5f2]"
                  }`}
                  onClick={() => changeCategory(tab)}
                >
                  {tabLabels[tab]}
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_190px_170px_auto] md:items-end">
              <label>
                <span className="field-label">Search</span>
                <input
                  type="search"
                  className="field-input"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search member, caption, lifegroup, or leader"
                />
              </label>
              {category === "user" ? (
                <label>
                  <span className="field-label">Account type</span>
                  <select
                    className="field-input"
                    value={accountType}
                    onChange={(event) => changeAccountType(event.target.value as AccountType | "all")}
                  >
                    <option value="all">All account types</option>
                    <option value="web_admin">Web Admin Account</option>
                    <option value="regular_user">Regular User Account</option>
                  </select>
                </label>
              ) : null}
              <label>
                <span className="field-label">Status</span>
                <select
                  className="field-input"
                  value={status}
                  onChange={(event) => changeStatus(event.target.value as Status | "all")}
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="all">All statuses</option>
                </select>
              </label>
              <label>
                <span className="field-label">Date order</span>
                <select
                  className="field-input"
                  value={sortAsc ? "oldest" : "newest"}
                  onChange={(event) => changeSort(event.target.value === "oldest")}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-ghost h-[42px] px-4 text-xs"
                onClick={() => {
                  setSearchInput("");
                  setCategory("all");
                  setStatus("pending");
                  setSortAsc(false);
                  setAccountType("all");
                  setPage(0);
                }}
              >
                Reset
              </button>
            </div>
          </section>

          {feedback ? (
            <p className={feedback.tone === "error" ? "status-error" : "status-info"} role="status">
              {feedback.message}
            </p>
          ) : null}

          {loading ? (
            <section className="grid gap-3" aria-label="Loading verification requests">
              {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse rounded-2xl border border-[#c4d3ce] bg-white/70 p-5">
                  <div className="h-3 w-32 rounded bg-[#dce7e2]" />
                  <div className="mt-4 h-5 w-52 rounded bg-[#dce7e2]" />
                  <div className="mt-3 h-16 rounded-xl bg-[#e8f0ed]" />
                </div>
              ))}
            </section>
          ) : requests.length ? (
            <section className="grid gap-3" aria-label="Verification requests">
              {requests.map((request) => (
                <RequestCard
                  key={request.request_id}
                  request={request}
                  images={socialImages[request.request_id] ?? []}
                  submissionUrl={submissionImageUrls[request.request_id] ?? null}
                  submitterAvatarUrl={
                    request.submitter_avatar_url
                      ? avatarUrls[request.submitter_avatar_url] ?? resolveProfileImage(request.submitter_avatar_url)
                      : null
                  }
                  currentProfileUrl={
                    request.current_profile_img_url
                      ? avatarUrls[request.current_profile_img_url] ?? resolveProfileImage(request.current_profile_img_url)
                      : null
                  }
                  history={historyFor(request)}
                  reviewerNames={reviewerNames}
                  reviewingKey={reviewingKey}
                  onReview={openReview}
                />
              ))}
            </section>
          ) : (
            <section className="card text-center">
              <p className="font-[var(--font-heading)] text-xl text-[#22332d]">No matching requests</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-[#5d7269]">
                {status === "all" ? "There are no requests" : `There are no ${status} requests`} in{" "}
                {category === "all" ? "any category" : tabLabels[category].toLowerCase()}.
              </p>
            </section>
          )}

          {!loading && total > 0 ? (
            <Pagination page={page} total={total} onPageChange={setPage} />
          ) : null}
        </>
      ) : null}

      {reviewDialog ? (
        <ReviewDialogModal
          dialog={reviewDialog}
          rejectionReason={rejectionReason}
          onRejectionReasonChange={setRejectionReason}
          busy={Boolean(reviewingKey)}
          onCancel={() => {
            if (reviewingKey) return;
            setReviewDialog(null);
          }}
          onConfirm={() => void review()}
        />
      ) : null}

      {notification ? (
        <AppNotification
          tone={notification.tone}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      ) : null}
    </div>
  );
}
