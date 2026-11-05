import type { Metadata } from "next";
import LegalPageShell from "@/components/legal-page-shell";
import { TERMS_LAST_UPDATED, termsSections } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Terms and Conditions | MyPresence",
  description: "Terms and conditions for accessing and using the MyPresence website."
};

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms and Conditions"
      description="The rules for accessing and using the MyPresence website, including account responsibilities, facial recognition, and acceptable use."
      lastUpdated={TERMS_LAST_UPDATED}
    >
      {termsSections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">{section.title}</h2>
          {section.content ? (
            section.content.map((block, index) =>
              block.type === "paragraph" ? (
                <p
                  key={`${section.id}-paragraph-${index}`}
                  className="mt-3 text-sm leading-7 text-[#4f675e]"
                >
                  {block.text}
                </p>
              ) : (
                <ul
                  key={`${section.id}-bullets-${index}`}
                  className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-[#4f675e]"
                >
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            )
          ) : (
            <>
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
            </>
          )}
        </section>
      ))}
    </LegalPageShell>
  );
}
