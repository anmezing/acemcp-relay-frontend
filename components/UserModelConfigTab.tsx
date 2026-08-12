"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RERANK_PROVIDER_PRESETS,
  type RerankProvider,
} from "@/lib/rerank-providers";

interface FormState {
  provider: RerankProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_FORM: FormState = {
  provider: "siliconflow-compatible",
  model: "",
  baseUrl: RERANK_PROVIDER_PRESETS["siliconflow-compatible"].baseUrl,
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
  const [activeSide, setActiveSide] = useState<"embeddings" | "rerank">("rerank");
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [platformDefaults, setPlatformDefaults] = useState({
    embeddings: { provider: "", model: "", baseUrl: "" },
    rerank: { provider: "", model: "", baseUrl: "" },
  });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [configuredProvider, setConfiguredProvider] = useState<RerankProvider | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
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
        const provider = data.rerank.provider as RerankProvider;
        const preset = RERANK_PROVIDER_PRESETS[provider];
        setConfiguredProvider(provider);
        setForm({
          provider,
          model: data.rerank.model,
          baseUrl: provider === "custom" ? data.rerank.baseUrl : preset.baseUrl,
          apiKey: "",
        });
        setModelOptions(
          provider === "custom"
            ? []
            : [...new Set([data.rerank.model, ...preset.models].filter(Boolean))]
        );
      } else {
        setConfiguredProvider(null);
        setForm(EMPTY_FORM);
        setModelOptions([]);
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

  const selectProvider = (provider: RerankProvider) => {
    const preset = RERANK_PROVIDER_PRESETS[provider];
    setForm({
      provider,
      baseUrl: preset.baseUrl,
      apiKey: "",
      model: preset.models[0] || "",
    });
    setModelOptions([...preset.models]);
    setNotice("");
  };

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/model-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: form.provider, apiKey: form.apiKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const models = Array.isArray(data.models)
        ? data.models.filter((model: unknown): model is string => typeof model === "string")
        : [];
      if (models.length === 0) throw new Error("没有可用的 Rerank 模型");
      setModelOptions(models);
      setForm((current) => ({
        ...current,
        model: models.includes(current.model) ? current.model : models[0],
      }));
      showNotice(`已获取 ${models.length} 个 Rerank 模型`, true);
    } catch (error) {
      showNotice(`获取模型失败：${error instanceof Error ? error.message : String(error)}`, false);
    } finally {
      setModelsLoading(false);
    }
  }, [form.apiKey, form.provider]);

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
      <div className="flex items-center gap-1 border-b border-white/[0.08]" role="tablist" aria-label="模型类型">
        <button
          type="button"
          role="tab"
          aria-selected={activeSide === "embeddings"}
          onClick={() => setActiveSide("embeddings")}
          className={cn(
            "border-b-2 px-2.5 py-2 text-xs transition-colors",
            activeSide === "embeddings"
              ? "border-cyan-400 text-cyan-300"
              : "border-transparent text-slate-500 hover:text-slate-300"
          )}
        >
          Embedding
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSide === "rerank"}
          onClick={() => setActiveSide("rerank")}
          className={cn(
            "border-b-2 px-2.5 py-2 text-xs transition-colors",
            activeSide === "rerank"
              ? "border-cyan-400 text-cyan-300"
              : "border-transparent text-slate-500 hover:text-slate-300"
          )}
        >
          Rerank
        </button>
      </div>

      {activeSide === "embeddings" ? (
        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">Embedding</h3>
              <p className="mt-1 text-xs text-slate-500">
                Embedding 由平台统一管理，保证所有用户共享索引的向量空间一致，当前不可在个人设置中修改。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider">
                <input
                  readOnly
                  value={platformDefaults.embeddings.provider || "平台统一配置"}
                  className={cn(inputCls, "cursor-default text-slate-400")}
                />
              </Field>
              <Field label="Model">
                <input
                  readOnly
                  value={platformDefaults.embeddings.model || "平台统一配置"}
                  className={cn(inputCls, "cursor-default text-slate-400")}
                />
              </Field>
              <Field label="Base URL">
                <input
                  readOnly
                  value={platformDefaults.embeddings.baseUrl || "平台统一配置"}
                  className={cn(inputCls, "cursor-default text-slate-400")}
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      ) : !enabled ? (
        <p className="text-slate-500 text-sm py-6">
          {platformDefaults.rerank.model || "平台 Rerank"}
        </p>
      ) : (
        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
          <CardContent className="p-4 space-y-4">
            <h3 className="text-white text-sm font-medium">Rerank</h3>
            <div className="grid gap-3">
              <Field label="供应商">
                <select
                  value={form.provider}
                  onChange={(event) => selectProvider(event.target.value as RerankProvider)}
                  className={inputCls}
                >
                  {Object.entries(RERANK_PROVIDER_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Base URL">
                <input
                  value={form.baseUrl}
                  onChange={(event) => set({ baseUrl: event.target.value })}
                  readOnly={form.provider !== "custom"}
                  placeholder="https://provider.example.com/v1/rerank"
                  className={cn(inputCls, form.provider !== "custom" && "cursor-default text-slate-400")}
                />
              </Field>
              <Field
                label={
                  configured && form.provider === configuredProvider
                    ? "API Key（留空表示使用已保存的 Key）"
                    : "API Key"
                }
              >
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) => set({ apiKey: event.target.value })}
                    placeholder={
                      configured && form.provider === configuredProvider ? "已保存" : "sk-..."
                    }
                    className={inputCls}
                  />
                  {RERANK_PROVIDER_PRESETS[form.provider].dynamicModels && (
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      onClick={fetchModels}
                      disabled={modelsLoading || (!form.apiKey && form.provider !== configuredProvider)}
                      className="h-[30px] shrink-0 px-3 text-xs text-cyan-400"
                    >
                      {modelsLoading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      获取模型
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="模型">
                {form.provider === "custom" ? (
                  <input
                    value={form.model}
                    onChange={(event) => set({ model: event.target.value })}
                    placeholder="输入兼容服务的模型 ID"
                    className={inputCls}
                  />
                ) : (
                  <select
                    value={form.model}
                    onChange={(event) => set({ model: event.target.value })}
                    disabled={modelOptions.length === 0}
                    className={cn(inputCls, modelOptions.length === 0 && "cursor-not-allowed text-slate-600")}
                  >
                    {modelOptions.length === 0 ? (
                      <option value="">
                        {form.provider === "siliconflow-compatible"
                          ? "填写 API Key 后获取模型"
                          : "暂无可用模型"}
                      </option>
                    ) : modelOptions.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                )}
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
          <Button
            variant="glass"
            size="sm"
            disabled={busy || !form.model || !form.baseUrl || (!form.apiKey && form.provider !== configuredProvider)}
            onClick={save}
            className="text-xs text-cyan-400"
          >
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
