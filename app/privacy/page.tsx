import Link from "next/link";
import { I18nText } from "@/components/I18nText";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#060b14] px-6 py-16 text-slate-200">
      <article className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-cyan-400">LCE</Link>
        <h1 className="text-3xl font-semibold text-white"><I18nText id="privacyTitle" /></h1>
        <p><I18nText id="privacyParagraph1" /></p>
        <p><I18nText id="privacyParagraph2" /></p>
        <p><I18nText id="privacyParagraph3" /></p>
        <h2 className="text-xl font-semibold text-white"><I18nText id="privacyCodeUploadTitle" /></h2>
        <p><I18nText id="privacyCodeUpload1" /></p>
        <p><I18nText id="privacyCodeUpload2" /></p>
        <p><I18nText id="privacyCodeUpload3" /></p>
      </article>
    </main>
  );
}
