import type { Metadata } from "next";
import LegalPageShell from "@/components/legal-page-shell";
import { PRIVACY_LAST_UPDATED, privacySections } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Privacy Notice | MyPresence",
  description: "How the MyPresence website collects, uses, stores, and protects personal information."
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Notice"
      description="How MyPresence handles account, member, attendance, face, event, verification, and security information."
      lastUpdated={PRIVACY_LAST_UPDATED}
    >
      {privacySections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="mt-3 text-sm leading-7 text-[#4f675e]">
              {paragraph}
            </p>
          ))}
          {section.bullets ? (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-[#4f675e]">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </LegalPageShell>
  );
}
