"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormState {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_FORM: FormState = {
  provider: "siliconflow-compatible",
  model: "",
  baseUrl: "",
  apiKey: "",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-slate-500 text-xs mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 font-mono";

export function UserModelConfigTab() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [platformDefaults, setPlatformDefaults] = useState({
    embeddings: { provider: "", model: "" },
    rerank: { provider: "", model: "" },
  });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/model-config", { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (signal?.aborted) return;
      setEnabled(data.enabled);
      setConfigured(data.configured);
      if (data.platformDefaults) setPlatformDefaults(data.platformDefaults);
      if (data.configured && data.rerank) {
        setForm({
          provider: data.rerank.provider,
          model: data.rerank.model,
          baseUrl: data.rerank.baseUrl,
          apiKey: "",
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setLoaded(true);
    } catch {
      if (signal?.aborted) return;
      setNotice("加载失败，请刷新重试");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const showNotice = (text: string, ok: boolean) => {
    setNotice(text);
    setNoticeOk(ok);
  };

  const save = useCallback(async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rerank: form }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      showNotice("Rerank 配置已保存", true);
      await load();
    } catch (error) {
      showNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`, false);
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  const reset = useCallback(async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showNotice("已恢复平台 Rerank", true);
      await load();
    } catch {
      showNotice("操作失败，请重试", false);
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!loaded) return <Skeleton className="h-64 bg-white/[0.06] rounded-xl" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Embedding</span>
        <span className="font-mono text-slate-300">
          {platformDefaults.embeddings.model || "平台统一配置"}
        </span>
        <span className="text-slate-700">|</span>
        <span className={cn(
          "px-2 py-0.5 rounded border",
          configured
            ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
            : "bg-slate-500/10 text-slate-400 border-slate-500/20"
        )}>
          {configured ? "自定义 Rerank" : "平台 Rerank"}
        </span>
      </div>

      {!enabled ? (
        <p className="text-slate-500 text-sm py-6">
          {platformDefaults.rerank.model || "平台 Rerank"}
        </p>
      ) : (
        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="p-4 space-y-4">
            <h3 className="text-white text-sm font-medium">Rerank</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Provider">
                <select value={form.provider} onChange={(event) => set({ provider: event.target.value })} className={inputCls}>
                  <option value="siliconflow-compatible">siliconflow-compatible</option>
                  <option value="voyage">voyage</option>
                  <option value="custom">custom</option>
                </select>
              </Field>
              <Field label="Model">
                <input value={form.model} onChange={(event) => set({ model: event.target.value })}
                  placeholder="bge-reranker-v2-m3" className={inputCls} />
              </Field>
              <Field label="Base URL">
                <input value={form.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })}
                  placeholder="https://api.siliconflow.cn/v1/rerank" className={inputCls} />
              </Field>
              <Field label={configured ? "API Key（留空表示不修改）" : "API Key"}>
                <input type="password" value={form.apiKey} onChange={(event) => set({ apiKey: event.target.value })}
                  placeholder={configured ? "已保存" : "sk-..."} className={inputCls} />
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      {notice && (
        <p className={cn("text-xs", noticeOk ? "text-emerald-400" : "text-red-400")}>{notice}</p>
      )}

      {enabled && (
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" size="sm" disabled={busy} onClick={save} className="text-xs text-cyan-400">
            <Save className="w-3.5 h-3.5" />
            保存
          </Button>
          {configured && (
            <Button variant="glass" size="sm" disabled={busy} onClick={reset} className="text-xs text-slate-400">
              <RotateCcw className="w-3.5 h-3.5" />
              恢复平台配置
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
