"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormState {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dimensions: string;
  queryPrefix: string;
  documentPrefix: string;
  rerankEnabled: boolean;
  rerankProvider: string;
  rerankModel: string;
  rerankBaseUrl: string;
  rerankApiKey: string;
}

const EMPTY_FORM: FormState = {
  provider: "openai-compatible",
  model: "",
  baseUrl: "",
  apiKey: "",
  dimensions: "1024",
  queryPrefix: "",
  documentPrefix: "",
  rerankEnabled: false,
  rerankProvider: "siliconflow-compatible",
  rerankModel: "",
  rerankBaseUrl: "",
  rerankApiKey: "",
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
  const [pendingReindex, setPendingReindex] = useState(false);
  const [platformDefaults, setPlatformDefaults] = useState({ embeddings: { provider: "", model: "" }, rerank: { provider: "", model: "" } });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);

  // load 首个语句即 await（满足 react-hooks/set-state-in-effect）；
  // effect 发起的请求携带 AbortSignal，卸载时 abort，之后不再 setState。
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/model-config", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setEnabled(data.enabled);
      setConfigured(data.configured);
      setPendingReindex(!!data.pendingReindex);
      if (data.platformDefaults) setPlatformDefaults(data.platformDefaults);
      if (data.configured && data.embeddings) {
        setForm({
          provider: data.embeddings.provider,
          model: data.embeddings.model,
          baseUrl: data.embeddings.baseUrl,
          apiKey: "",
          dimensions: String(data.embeddings.dimensions),
          queryPrefix: data.embeddings.queryPrefix || "",
          documentPrefix: data.embeddings.documentPrefix || "",
          rerankEnabled: !!data.rerank,
          rerankProvider: data.rerank?.provider || "siliconflow-compatible",
          rerankModel: data.rerank?.model || "",
          rerankBaseUrl: data.rerank?.baseUrl || "",
          rerankApiKey: "",
        });
      }
      setLoaded(true);
    } catch {
      if (signal?.aborted) return;
      setNotice("加载失败，请刷新重试");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // 经微任务发起以满足 react-hooks/set-state-in-effect；cleanup 时 abort，
    // load 内的 signal.aborted 检查保证之后不再 setState
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const buildPayload = () => ({
    embeddings: {
      provider: form.provider,
      model: form.model,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      dimensions: parseInt(form.dimensions),
      queryPrefix: form.queryPrefix || undefined,
      documentPrefix: form.documentPrefix || undefined,
    },
    rerank: form.rerankEnabled
      ? {
          provider: form.rerankProvider,
          model: form.rerankModel,
          baseUrl: form.rerankBaseUrl,
          apiKey: form.rerankApiKey,
        }
      : null,
  });

  const showNotice = (text: string, ok: boolean) => {
    setNotice(text);
    setNoticeOk(ok);
  };

  const testConnection = useCallback(async () => {
    setBusy(true);
    showNotice("测试中…", true);
    try {
      const res = await fetch("/api/model-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeddings: buildPayload().embeddings }),
      });
      const data = await res.json();
      if (data.ok) {
        showNotice(
          data.dimensionsMatch
            ? `连通成功，向量维度 ${data.dimensions}，与配置一致`
            : `连通成功，但实际维度 ${data.dimensions} 与配置的 ${form.dimensions} 不一致，请修正维度`,
          data.dimensionsMatch
        );
      } else {
        showNotice(`测试失败：${data.error}`, false);
      }
    } catch {
      showNotice("测试失败，请重试", false);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const save = useCallback(async () => {
    if (!confirm("保存自定义模型后，你的检索索引将被清空并在插件下次扫描时自动重建（embedding 费用走你自己的 key）。确认保存？")) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showNotice("已保存。索引将在插件下次扫描时自动重建", true);
      await load();
    } catch (error) {
      showNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`, false);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, load]);

  const reset = useCallback(async () => {
    if (!confirm("恢复平台默认模型？你的索引将被清空并按平台模型自动重建。")) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      showNotice("已恢复平台默认。索引将自动重建", true);
      await load();
    } catch {
      showNotice("操作失败，请重试", false);
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!loaded) return <Skeleton className="h-64 bg-white/[0.06] rounded-xl" />;

  if (!enabled) {
    return (
      <p className="text-slate-500 text-sm py-6">
        当前部署未启用自定义模型（管理员未配置 MODEL_CONFIG_SECRET），全站使用平台默认模型
        {platformDefaults.embeddings.model && (
          <span className="font-mono text-slate-400"> {platformDefaults.embeddings.model}</span>
        )}。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(
          "text-xs px-2 py-0.5 rounded border",
          configured
            ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
            : "bg-slate-500/10 text-slate-400 border-slate-500/20"
        )}>
          {configured ? "使用自定义模型" : "使用平台默认"}
        </span>
        {!configured && platformDefaults.embeddings.model && (
          <span className="text-slate-600 text-xs font-mono">{platformDefaults.embeddings.model}</span>
        )}
        {pendingReindex && (
          <span className="text-xs px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">
            等待重建索引（插件下次扫描时自动进行）
          </span>
        )}
      </div>

      <p className="text-slate-500 text-xs leading-relaxed">
        配置你自己的 embedding（必填）与 rerank（可选）模型，检索与索引将使用你的
        API key 计费。<span className="text-amber-400/80">切换模型会清空并重建你的索引</span>；
        仅更换 API key（模型不变）不会触发重建。密钥加密存储，页面不回显。
      </p>

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-white text-sm font-medium">Embeddings（必填）</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Provider">
              <select value={form.provider} onChange={(e) => set({ provider: e.target.value })} className={inputCls}>
                <option value="openai-compatible">openai-compatible</option>
                <option value="voyage">voyage</option>
              </select>
            </Field>
            <Field label="Model">
              <input value={form.model} onChange={(e) => set({ model: e.target.value })}
                placeholder="voyage-code-3 / bge-m3 …" className={inputCls} />
            </Field>
            <Field label="Base URL（https，指向 embeddings 端点）">
              <input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })}
                placeholder="https://api.voyageai.com/v1/embeddings" className={inputCls} />
            </Field>
            <Field label={configured ? "API Key（留空 = 不修改）" : "API Key"}>
              <input type="password" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })}
                placeholder={configured ? "已保存" : "sk-…"} className={inputCls} />
            </Field>
            <Field label="向量维度">
              <input inputMode="numeric" value={form.dimensions} onChange={(e) => set({ dimensions: e.target.value })}
                placeholder="1024" className={inputCls} />
            </Field>
          </div>
          <details className="text-xs">
            <summary className="text-slate-500 cursor-pointer select-none">高级：检索指令前缀（BGE/nomic 等模型需要）</summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="Query 前缀（仅查询侧）">
                <input value={form.queryPrefix} onChange={(e) => set({ queryPrefix: e.target.value })}
                  placeholder="query: " className={inputCls} />
              </Field>
              <Field label="Document 前缀（影响索引，改动会触发重建）">
                <input value={form.documentPrefix} onChange={(e) => set({ documentPrefix: e.target.value })}
                  placeholder="passage: " className={inputCls} />
              </Field>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
        <CardContent className="p-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.rerankEnabled}
              onChange={(e) => set({ rerankEnabled: e.target.checked })} className="accent-cyan-500" />
            <h3 className="text-white text-sm font-medium">Rerank（可选，不配则使用平台默认）</h3>
          </label>
          {form.rerankEnabled && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Provider">
                <select value={form.rerankProvider} onChange={(e) => set({ rerankProvider: e.target.value })} className={inputCls}>
                  <option value="siliconflow-compatible">siliconflow-compatible</option>
                  <option value="voyage">voyage</option>
                  <option value="custom">custom</option>
                </select>
              </Field>
              <Field label="Model">
                <input value={form.rerankModel} onChange={(e) => set({ rerankModel: e.target.value })}
                  placeholder="rerank-2.5 / bge-reranker-v2-m3 …" className={inputCls} />
              </Field>
              <Field label="Base URL（https，指向 rerank 端点）">
                <input value={form.rerankBaseUrl} onChange={(e) => set({ rerankBaseUrl: e.target.value })}
                  placeholder="https://api.siliconflow.cn/v1/rerank" className={inputCls} />
              </Field>
              <Field label={configured ? "API Key（留空 = 不修改）" : "API Key"}>
                <input type="password" value={form.rerankApiKey} onChange={(e) => set({ rerankApiKey: e.target.value })}
                  placeholder={configured ? "已保存" : "sk-…"} className={inputCls} />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {notice && (
        <p className={cn("text-xs", noticeOk ? "text-emerald-400" : "text-red-400")}>{notice}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="glass" size="sm" disabled={busy} onClick={testConnection} className="text-xs">
          测试连接
        </Button>
        <Button variant="glass" size="sm" disabled={busy} onClick={save} className="text-xs text-cyan-400">
          保存
        </Button>
        {configured && (
          <Button variant="glass" size="sm" disabled={busy} onClick={reset} className="text-xs text-slate-400">
            恢复平台默认
          </Button>
        )}
      </div>
    </div>
  );
}
