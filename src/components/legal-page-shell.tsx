import Image from "next/image";
import Link from "next/link";

type LegalPageShellProps = {
  title: string;
  description: string;
  lastUpdated: string;
  children: React.ReactNode;
};

export default function LegalPageShell({
  title,
  description,
  lastUpdated,
  children
}: LegalPageShellProps) {
  return (
    <div className="min-h-screen bg-[#e9e9e9]">
      <header className="border-b border-[#c7d5cf] bg-[#eef3f1]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Back to MyPresence">
            <Image
              src="/logo.png"
              alt="MyPresence logo"
              width={40}
              height={40}
              className="h-10 w-auto object-contain"
              priority
            />
            <span>
              <span className="block font-[var(--font-heading)] text-xl text-[#1f2f29]">MyPresence</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5d7269]">
                HPCI Thrive
              </span>
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#35564a]" aria-label="Legal pages">
            <Link className="rounded-full px-3 py-1.5 hover:bg-white/80" href="/terms">
              Terms
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-white/80" href="/privacy">
              Privacy
            </Link>
            <Link className="rounded-full bg-[#385b4f] px-3 py-1.5 text-white hover:bg-[#2f4e44]" href="/">
              Back to app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-14">
        <article className="rounded-3xl border border-[#c3d0cb] bg-white/90 p-6 shadow-[0_18px_36px_rgba(56,91,79,0.12)] md:p-10">
          <header className="border-b border-[#d6e1dd] pb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#527064]">MyPresence</p>
            <h1 className="mt-2 font-[var(--font-heading)] text-3xl text-[#1f2f29] md:text-4xl">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-[#5d7269]">{description}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-[#7a8b84]">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="mt-7 space-y-8">{children}</div>
        </article>

        <footer className="mt-6 rounded-2xl border border-[#c8d6d1] bg-white/70 p-5 text-sm text-[#5d7269]">
          <p>
            For questions about these terms or how MyPresence handles data, contact your church office or the
            MyPresence administrator who manages your account.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-[#35564a]">
            <Link className="hover:underline" href="/terms">
              Terms and Conditions
            </Link>
            <Link className="hover:underline" href="/privacy">
              Privacy Notice
            </Link>
            <Link className="hover:underline" href="/">
              Return to MyPresence
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
