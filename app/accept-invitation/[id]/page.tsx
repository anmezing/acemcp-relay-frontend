"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";
import { loginUrl } from "@/lib/auth-redirect";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslations } from "next-intl";
import { CLIENT_RUNTIME_POLICY } from "@/lib/client-runtime-policy";

// 邀请落地页：登录用户点击接受后，better-auth 建 member 记录，
// afterAcceptInvitation hook 自动发组织密钥。
export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("Invitation");
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId: id,
      });
      if (error) throw new Error(error.message || t("failedToAcceptInvitation"));
      setDone(true);
      setTimeout(() => router.push("/console"), CLIENT_RUNTIME_POLICY.invitationRedirectMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToAcceptInvitationItMayHave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0a0f1a] flex items-center justify-center px-4">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <Card className="bg-[#0d1424]/80 border-white/[0.08] w-full max-w-md">
        <CardContent className="p-8 text-center space-y-5">
          <Building2 className="w-10 h-10 text-cyan-400 mx-auto" />
          <h1 className="text-white text-lg font-medium">{t("organizationInvitation")}</h1>
          {isPending ? (
            <Loader2 className="w-6 h-6 animate-spin text-slate-500 mx-auto" />
          ) : !session ? (
            <>
              <p className="text-slate-400 text-sm">{t("logInBeforeAcceptingThisInvitation")}</p>
              <Button
                variant="gradient"
                onClick={() => router.push(loginUrl(`/accept-invitation/${encodeURIComponent(id)}`))}
              >
                {t("logIn")}
              </Button>
            </>
          ) : done ? (
            <p className="text-emerald-400 text-sm">
              {t("youJoinedTheOrganizationAndAnOrganization")}
            </p>
          ) : (
            <>
              <p className="text-slate-400 text-sm">
                {t("afterAcceptingYouWillJoinTheOrganization")}
              </p>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button variant="gradient" onClick={accept} disabled={busy}>
                {busy ? t("processing") : t("acceptInvitation")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
