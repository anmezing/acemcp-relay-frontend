import Link from "next/link";
import { I18nText } from "@/components/I18nText";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#060b14] px-6 py-16 text-slate-200">
      <article className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-cyan-400">LCE</Link>
        <h1 className="text-3xl font-semibold text-white"><I18nText id="termsTitle" /></h1>
        <p><I18nText id="termsParagraph1" /></p>
        <p><I18nText id="termsParagraph2" /></p>
        <p><I18nText id="termsParagraph3" /></p>
      </article>
    </main>
  );
}
