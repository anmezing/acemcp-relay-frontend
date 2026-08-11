"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";
import { loginUrl } from "@/lib/auth-redirect";

// 邀请落地页：登录用户点击接受后，better-auth 建 member 记录，
// afterAcceptInvitation hook 自动发组织密钥。
export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
      if (error) throw new Error(error.message || "接受邀请失败");
      setDone(true);
      setTimeout(() => router.push("/console"), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "接受邀请失败（可能已过期或已被处理）");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center px-4">
      <Card className="bg-[#0d1424]/80 border-white/[0.08] w-full max-w-md">
        <CardContent className="p-8 text-center space-y-5">
          <Building2 className="w-10 h-10 text-cyan-400 mx-auto" />
          <h1 className="text-white text-lg font-medium">组织邀请</h1>
          {isPending ? (
            <Loader2 className="w-6 h-6 animate-spin text-slate-500 mx-auto" />
          ) : !session ? (
            <>
              <p className="text-slate-400 text-sm">请先登录后再接受邀请。</p>
              <Button
                variant="gradient"
                onClick={() => router.push(loginUrl(`/accept-invitation/${encodeURIComponent(id)}`))}
              >
                去登录
              </Button>
            </>
          ) : done ? (
            <p className="text-emerald-400 text-sm">
              已加入组织，组织密钥已自动生成，正在跳转控制台…
            </p>
          ) : (
            <>
              <p className="text-slate-400 text-sm">
                接受后你将加入该组织，并自动获得一把组织专用密钥
                （公司项目用组织密钥，个人项目继续用个人密钥）。
              </p>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button variant="gradient" onClick={accept} disabled={busy}>
                {busy ? "处理中..." : "接受邀请"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
