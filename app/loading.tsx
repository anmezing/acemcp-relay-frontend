import { LceBrand } from "@/components/LceBrand";

export default function Loading() {
  return (
    <div className="min-h-dvh bg-[#0a0f1a] text-slate-200">
      <header className="flex h-[65px] items-center border-b border-white/[0.06] px-6">
        <LceBrand iconSize={32} textClassName="text-lg" priority />
      </header>
      <main className="mx-auto max-w-4xl px-6 py-20">
        <div className="mx-auto max-w-2xl space-y-5 text-center">
          <div className="mx-auto h-10 w-48 animate-pulse rounded-md bg-white/[0.06]" />
          <div className="mx-auto h-5 w-96 max-w-full animate-pulse rounded-md bg-white/[0.04]" />
          <div className="mx-auto h-10 w-32 animate-pulse rounded-md bg-white/[0.05]" />
        </div>
      </main>
    </div>
  );
}
