"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasSupabaseEnv, supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    if (!hasSupabaseEnv) {
      router.replace("/login");
      return;
    }

    const finish = async () => {
      await supabase.auth.getSession();
      router.replace("/login");
    };

    void finish();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9e9e9] px-6">
      <p className="text-sm font-semibold text-[#35564a]">Confirming your account...</p>
    </main>
  );
}
