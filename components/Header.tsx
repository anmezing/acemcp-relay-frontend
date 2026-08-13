import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LoginButton } from "./LoginButton";
import { LceBrand } from "./LceBrand";
import Link from "next/link";

export async function Header() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0a0f1a]/80 backdrop-blur-md border-b border-white/[0.04]">
      <Link href="/" aria-label="LCE 首页">
        <LceBrand iconSize={34} textClassName="text-lg" priority />
      </Link>
      <LoginButton user={session?.user} />
    </header>
  );
}
