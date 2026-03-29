import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import AppShell from "@/components/app-shell";
import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

const headingFont = Sora({
  subsets: ["latin"],
  variable: "--font-heading"
});

export const metadata: Metadata = {
  title: "Face Attendance System",
  description: "Web-based face recognition attendance with Next.js, face-api.js, and Supabase"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${headingFont.variable} font-[var(--font-body)]`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
