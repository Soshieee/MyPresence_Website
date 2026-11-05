"use client";

import Link from "next/link";
import { useState } from "react";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@/lib/help-content";
import { ONBOARDING_RESTART_EVENT, ONBOARDING_STORAGE_KEY } from "@/lib/onboarding";

const TROUBLESHOOTING_CATEGORY = "Troubleshooting and FAQs";

const TROUBLESHOOTING_ARTICLES = HELP_ARTICLES.filter(
  (article) => article.category === TROUBLESHOOTING_CATEGORY
);

const TOPIC_GROUPS = HELP_CATEGORIES.filter(
  (category) => category !== TROUBLESHOOTING_CATEGORY
).map((category) => ({
  category,
  articles: HELP_ARTICLES.filter((article) => article.category === category)
}));

function categorySlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-[#527064] transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-[#527064] transition-transform duration-200 group-hover:translate-x-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function HelpCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-.8.7-1.8 1.1-1.8 2.7" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

function AdminBadge() {
  return (
    <span className="rounded-full border border-[#d7b46a] bg-[#fff8e8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a5a17]">
      Admin
    </span>
  );
}

function ArticleDetails({ article }: { article: (typeof HELP_ARTICLES)[number] }) {
  return (
    <>
      <p className="text-sm leading-6 text-[#5d7269]">{article.description}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#425b52]">
        {article.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </>
  );
}

export default function HelpPage() {
  const [tourNotice, setTourNotice] = useState(false);
  const [openTroubleshooting, setOpenTroubleshooting] = useState(
    TROUBLESHOOTING_ARTICLES[0]?.id ?? ""
  );
  const [openTopic, setOpenTopic] = useState("");

  const restartTour = () => {
    try {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
      // The event still reopens the tour even if storage is unavailable.
    }

    window.dispatchEvent(new Event(ONBOARDING_RESTART_EVENT));
    setTourNotice(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6 reveal">
      <section className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="page-title font-[var(--font-heading)]">Help Center</h1>
          <p className="page-subtitle max-w-2xl">
            Fixes and answers for attendance, members, events, and your account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={restartTour}>
            Restart walkthrough
          </button>
          <Link href="/settings" className="btn-ghost">
            Open Settings
          </Link>
        </div>
      </section>

      {tourNotice ? (
        <p className="status-success" role="status">
          The walkthrough has been reopened. Finish or skip it when you are ready.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <section className="analytics-panel overflow-hidden p-0">
          <header className="border-b border-[#dfe8e4] bg-[#eef4f1] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#b9cac3] bg-white text-[#527064]">
                <HelpCircleIcon />
              </span>
              <div>
                <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">
                  Troubleshooting and FAQs
                </h2>
                <p className="text-sm text-[#5d7269]">Quick fixes for the most common problems.</p>
              </div>
            </div>
          </header>

          <div className="divide-y divide-[#e1e9e6]">
            {TROUBLESHOOTING_ARTICLES.map((article) => {
              const open = openTroubleshooting === article.id;
              const contentId = `${article.id}-content`;

              return (
                <article key={article.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[#f7fbf9]"
                    onClick={() =>
                      setOpenTroubleshooting((current) =>
                        current === article.id ? "" : article.id
                      )
                    }
                    aria-expanded={open}
                    aria-controls={contentId}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#22332d]">{article.title}</span>
                      {article.audience === "admin" ? <AdminBadge /> : null}
                    </span>
                    <ChevronIcon open={open} />
                  </button>
                  {open ? (
                    <div id={contentId} className="px-5 pb-5">
                      <ArticleDetails article={article} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="analytics-panel">
          <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">More information</h2>
          <p className="mt-2 text-sm leading-6 text-[#5d7269]">
            Review how MyPresence handles data and the rules for using the service.
          </p>
          <div className="mt-4 space-y-2">
            <Link
              href="/privacy"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-[#c8d6d1] bg-white/80 px-4 py-3 text-sm font-semibold text-[#22332d] transition hover:border-[#7d968c] hover:bg-[#f4f9f7]"
            >
              <span>Privacy Notice</span>
              <ArrowRightIcon />
            </Link>
            <Link
              href="/terms"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-[#c8d6d1] bg-white/80 px-4 py-3 text-sm font-semibold text-[#22332d] transition hover:border-[#7d968c] hover:bg-[#f4f9f7]"
            >
              <span>Terms and Conditions</span>
              <ArrowRightIcon />
            </Link>
            <Link
              href="/settings"
              className="group flex items-center justify-between gap-3 rounded-2xl border border-[#c8d6d1] bg-white/80 px-4 py-3 text-sm font-semibold text-[#22332d] transition hover:border-[#7d968c] hover:bg-[#f4f9f7]"
            >
              <span>Account Settings</span>
              <ArrowRightIcon />
            </Link>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">Guides by topic</h2>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">
            Open a topic to see its guides
          </p>
        </div>

        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {TOPIC_GROUPS.map((group) => {
            const open = openTopic === group.category;
            const contentId = `topic-${categorySlug(group.category)}-content`;

            return (
              <div
                key={group.category}
                className="overflow-hidden rounded-2xl border border-[#c8d6d1] bg-white/85 shadow-[0_8px_20px_rgba(56,91,79,0.06)]"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[#f4f9f7]"
                  onClick={() =>
                    setOpenTopic((current) => (current === group.category ? "" : group.category))
                  }
                  aria-expanded={open}
                  aria-controls={contentId}
                >
                  <span className="font-semibold text-[#22332d]">{group.category}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">
                      {group.articles.length} {group.articles.length === 1 ? "guide" : "guides"}
                    </span>
                    <ChevronIcon open={open} />
                  </span>
                </button>
                {open ? (
                  <div
                    id={contentId}
                    className="space-y-5 border-t border-[#e1e9e6] bg-[#fbfdfc] px-4 py-4"
                  >
                    {group.articles.map((article) => (
                      <article key={article.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[#22332d]">{article.title}</h3>
                          {article.audience === "admin" ? <AdminBadge /> : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[#5d7269]">{article.description}</p>
                        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-5 text-[#425b52]">
                          {article.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
