"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: JSX.Element;
};

const navItems: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M6.5 10.5V20h11V10.5" />
      </svg>
    )
  },
  {
    href: "/register",
    label: "Register",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    )
  },
  {
    href: "/attendance",
    label: "Scan",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M9 3v4M15 3v4M9 17v4M15 17v4" />
      </svg>
    )
  },
  {
    href: "/records",
    label: "Records",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 4h14v16H5z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    )
  },
  {
    href: "/events-manager",
    label: "Events",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7h16v13H4z" />
        <path d="M8 3v4M16 3v4M4 11h16" />
      </svg>
    )
  },
  {
    href: "/members",
    label: "Members",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" />
        <path d="M8 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" />
        <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M12.5 20a5.5 5.5 0 0 1 9 0" />
      </svg>
    )
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 15.5a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 15.5Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .95 1.7 1.7 0 0 0-.1.65V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.86.35l-.07.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.95-1 1.7 1.7 0 0 0-.65-.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.35-1.86l-.06-.07a2 2 0 0 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.95 1.7 1.7 0 0 0 .1-.65V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.86-.35l.07-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .95 1 1.7 1.7 0 0 0 .65.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5.9Z" />
      </svg>
    )
  }
];

function titleFromPath(pathname: string) {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/register") return "Member Registration";
  if (pathname === "/attendance") return "Live Attendance";
  if (pathname === "/records") return "Attendance Logs";
  if (pathname === "/events-manager") return "Event Manager";
  if (pathname === "/members") return "Member Management";
  if (pathname === "/settings") return "Settings";
  if (pathname === "/login") return "Login";
  return "MyPresence";
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [logoFailed, setLogoFailed] = useState(false);
  const [authChecked, setAuthChecked] = useState(() => !hasSupabaseEnv);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!hasSupabaseEnv) {
      if (pathname !== "/login") {
        router.replace("/login");
      }
      return;
    }

    let active = true;

    const syncSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!active) return;

      const authed = Boolean(session);
      setIsAuthenticated(authed);
      setAuthChecked(true);

      if (!authed && pathname !== "/login") {
        router.replace("/login");
      }

      if (authed && pathname === "/login") {
        router.replace("/");
      }
    };

    void syncSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const authed = Boolean(session);
      setIsAuthenticated(authed);
      setAuthChecked(true);

      if (!authed && pathname !== "/login") {
        router.replace("/login");
      }

      if (authed && pathname === "/login") {
        router.replace("/");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  const handleSignOut = async () => {
    if (!hasSupabaseEnv || signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    setSigningOut(false);
    router.replace("/login");
  };

  const activePath = pathname;
  const currentTitle = titleFromPath(activePath);

  if (pathname === "/login") {
    if (!hasSupabaseEnv) {
      return (
        <div className="min-h-screen bg-[#e9e9e9] px-6 py-10">
          <div className="mx-auto max-w-xl rounded-3xl border border-[#e2b9bb] bg-white p-6 shadow-[0_18px_36px_rgba(56,91,79,0.14)]">
            <h1 className="font-[var(--font-heading)] text-2xl text-[#22332d]">Supabase Setup Required</h1>
            <p className="mt-3 text-sm text-[#5d7269]">
              {supabaseEnvIssue ?? "Missing Supabase environment values in .env.local."}
            </p>
          </div>
        </div>
      );
    }

    return <>{children}</>;
  }

  if (!authChecked || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e9e9e9] px-6 py-10">
        <div className="mx-auto max-w-md rounded-3xl border border-[#c3d0cb] bg-white/90 p-6 text-center shadow-[0_18px_36px_rgba(56,91,79,0.14)]">
          <p className="font-[var(--font-heading)] text-xl text-[#22332d]">Checking session...</p>
          <p className="mt-2 text-sm text-[#5d7269]">Redirecting to login if needed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <aside className="app-rail hidden md:flex">
        <div className="app-rail__brand app-rail__brand--logo">
          {!logoFailed ? (
            <img
              src="/logo.png"
              alt="MyPresence logo"
              className="app-rail__brand-image"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span>MP</span>
          )}
        </div>
        <nav className="app-rail__nav" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const active = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`app-rail__item ${active ? "app-rail__item--active" : ""}`}
                title={item.label}
              >
                <span className="app-rail__glyph">{item.icon}</span>
                <span className="app-rail__label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="md:ml-[84px]">
        <header className="border-b border-[#c7d5cf] bg-[#eef3f1]/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-8">
            <div className="flex items-center gap-3">
              {!logoFailed ? (
                <img
                  src="/logo.png"
                  alt="MyPresence logo"
                  className="h-8 w-8 rounded-md border border-[#b9cac3] bg-white/90 object-contain p-1"
                  onError={() => setLogoFailed(true)}
                />
              ) : null}
              <p className="font-[var(--font-heading)] text-2xl text-[#1f2f29]">{currentTitle}</p>
            </div>
            <button type="button" className="btn-ghost py-2 text-xs" onClick={() => void handleSignOut()} disabled={signingOut}>
              {signingOut ? "Signing Out..." : "Sign Out"}
            </button>
          </div>
          <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
            {navItems.map((item) => {
              const active = activePath === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    active ? "bg-[#385b4f] text-white" : "bg-white/80 text-[#35564a]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
