"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RERANK_PROVIDER_PRESETS, type RerankProvider } from "@/lib/rerank-providers";
import { cn } from "@/lib/utils";

type EmbeddingProvider = "openai-compatible" | "voyage";
type ModelKind = "embeddings" | "rerank";

interface ModelForm {
  embeddings: {
    provider: EmbeddingProvider;
    model: string;
    baseUrl: string;
    dimensions: number;
    outputDimension?: number;
    outputDtype?: "float";
    queryPrefix?: string;
    documentPrefix?: string;
    apiKey: string;
  };
  rerank: {
    provider: RerankProvider;
    model: string;
    baseUrl: string;
    apiKey: string;
  };
}

interface ModelView {
  embeddings: Omit<ModelForm["embeddings"], "apiKey"> & { apiKeyConfigured: boolean };
  rerank: Omit<ModelForm["rerank"], "apiKey"> & { apiKeyConfigured: boolean };
}

const inputClass =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none font-mono";
const VOYAGE_EMBEDDING_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_EMBEDDING_MODELS = ["voyage-code-3"] as const;
const CLOUD_INDEX_DIMENSIONS = 1024;

function toForm(config: ModelView): ModelForm {
  const embeddings = { ...config.embeddings };
  const rerank = { ...config.rerank };
  delete (embeddings as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  delete (rerank as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  if (embeddings.provider === "voyage" && embeddings.outputDimension === undefined) {
    embeddings.outputDimension = CLOUD_INDEX_DIMENSIONS;
  }
  return {
    embeddings: { ...embeddings, apiKey: "" },
    rerank: { ...rerank, apiKey: "" },
  };
}

function uniqueModels(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat().map((model) => model.trim()).filter(Boolean))];
}

function Field({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-slate-600">{hint}</span>}
    </label>
  );
}

export function AdminModelsTab() {
  const [view, setView] = useState<ModelView | null>(null);
  const [form, setForm] = useState<ModelForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [modelsLoading, setModelsLoading] = useState<ModelKind | null>(null);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [rerankModels, setRerankModels] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async (signal?: AbortSignal, clearNotice = true) => {
    try {
      const response = await fetch("/api/admin/model-config", {
        signal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (signal?.aborted) return;
      setView(data.config);
      setForm(toForm(data.config));
      setEmbeddingModels([]);
      setRerankModels([]);
      if (clearNotice) setNotice("");
    } catch (error) {
      if (signal?.aborted) return;
      setNotice(error instanceof Error ? error.message : "加载失败，请重试");
      setNoticeOk(false);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const updateEmbeddings = useCallback((patch: Partial<ModelForm["embeddings"]>) => {
    setForm((current) => current && {
      ...current,
      embeddings: { ...current.embeddings, ...patch },
    });
  }, []);

  const updateRerank = useCallback((patch: Partial<ModelForm["rerank"]>) => {
    setForm((current) => current && {
      ...current,
      rerank: { ...current.rerank, ...patch },
    });
  }, []);

  const canReuseEmbeddingKey = Boolean(
    view &&
    form &&
    view.embeddings.apiKeyConfigured &&
    form.embeddings.provider === view.embeddings.provider &&
    form.embeddings.baseUrl.trim() === view.embeddings.baseUrl,
  );
  const canReuseRerankKey = Boolean(
    view &&
    form &&
    view.rerank.apiKeyConfigured &&
    form.rerank.provider === view.rerank.provider &&
    form.rerank.baseUrl.trim() === view.rerank.baseUrl,
  );

  const discoverModels = useCallback(async (kind: ModelKind) => {
    if (!form) return;
    const target = form[kind];
    setModelsLoading(kind);
    setNotice("");
    try {
      const response = await fetch("/api/admin/model-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          provider: target.provider,
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const models = Array.isArray(data.models)
        ? data.models.filter((model: unknown): model is string => typeof model === "string" && model.trim() !== "")
        : [];
      if (models.length === 0) throw new Error("供应商未返回可用模型");
      if (kind === "embeddings") {
        setEmbeddingModels(models);
        updateEmbeddings({ model: models.includes(form.embeddings.model) ? form.embeddings.model : models[0] });
      } else {
        setRerankModels(models);
        updateRerank({ model: models.includes(form.rerank.model) ? form.rerank.model : models[0] });
      }
      setNotice(`已获取 ${models.length} 个${kind === "embeddings" ? " Embedding" : " Rerank"} 模型`);
      setNoticeOk(true);
    } catch (error) {
      setNotice(`获取模型失败：${error instanceof Error ? error.message : String(error)}`);
      setNoticeOk(false);
    } finally {
      setModelsLoading(null);
    }
  }, [form, updateEmbeddings, updateRerank]);

  const submit = useCallback(async (confirmEmbeddingReset: boolean) => {
    if (!form) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: form, confirmEmbeddingReset }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.requiresEmbeddingReset) {
        setConfirmReset(true);
        return;
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setConfirmReset(false);
      await load(undefined, false);
      setNotice(data.embeddingChanged
        ? "配置已保存，旧索引已清除；现有项目需要重新索引"
        : "模型配置已保存并立即生效");
      setNoticeOk(true);
    } catch (error) {
      setNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      setNoticeOk(false);
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  const validationError = useMemo(() => {
    if (!form) return "";
    if (!form.embeddings.baseUrl.trim()) return "请填写 Embedding Base URL";
    if (!form.embeddings.apiKey.trim() && !canReuseEmbeddingKey) return "请填写 Embedding API Key";
    if (!form.embeddings.model.trim()) return form.embeddings.provider === "openai-compatible"
      ? "请先获取并选择 Embedding 模型"
      : "请选择 Embedding 模型";
    if (!Number.isSafeInteger(form.embeddings.dimensions) || form.embeddings.dimensions <= 0) {
      return "请输入有效的 Embedding 索引维度";
    }
    if (form.embeddings.dimensions !== CLOUD_INDEX_DIMENSIONS) {
      return `云端索引当前固定为 ${CLOUD_INDEX_DIMENSIONS} 维；修改数据库向量维度需要单独迁移并重建索引`;
    }
    if (
      form.embeddings.provider === "voyage" &&
      form.embeddings.outputDimension !== undefined &&
      form.embeddings.outputDimension !== form.embeddings.dimensions
    ) {
      return "Voyage 供应商输出维度必须与索引维度一致（当前为 1024）";
    }
    if (!form.rerank.baseUrl.trim()) return "请填写 Rerank Base URL";
    if (!form.rerank.apiKey.trim() && !canReuseRerankKey) return "请填写 Rerank API Key";
    if (!form.rerank.model.trim()) return form.rerank.provider === "siliconflow-compatible"
      ? "请先获取并选择 Rerank 模型"
      : "请选择或填写 Rerank 模型";
    return "";
  }, [canReuseEmbeddingKey, canReuseRerankKey, form]);

  if (loading) return <Skeleton className="h-72 rounded-xl bg-white/[0.06]" />;
  if (!form || !view) {
    return <p className="text-sm text-red-400">{notice || "模型配置加载失败"}</p>;
  }

  const rerankPreset = RERANK_PROVIDER_PRESETS[form.rerank.provider];
  const embeddingOptions = uniqueModels(
    form.embeddings.provider === "voyage" ? [...VOYAGE_EMBEDDING_MODELS] : [],
    embeddingModels,
    [form.embeddings.model],
  );
  const rerankOptions = uniqueModels(
    [...rerankPreset.models],
    rerankModels,
    [form.rerank.model],
  );

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500">
        配置保存在 LCE 数据库并立即生效。API Key 不回显；只有供应商和 Base URL
        都未变化时，留空才会沿用当前 Key。
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">Embeddings</h3>
              <p className="mt-1 text-[10px] text-slate-600">
                切换 Embedding 会清除旧向量索引，避免不同向量空间混用。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="1. 供应商">
                <select
                  value={form.embeddings.provider}
                  onChange={(event) => {
                    const provider = event.target.value as EmbeddingProvider;
                    setEmbeddingModels([]);
                    updateEmbeddings({
                      provider,
                      baseUrl: provider === "voyage" ? VOYAGE_EMBEDDING_URL : "",
                      model: provider === "voyage" ? VOYAGE_EMBEDDING_MODELS[0] : "",
                      apiKey: "",
                      dimensions: 1024,
                      outputDimension: provider === "voyage" ? 1024 : undefined,
                      outputDtype: provider === "voyage" ? "float" : undefined,
                    });
                  }}
                  className={inputClass}
                >
                  <option value="voyage">Voyage AI</option>
                  <option value="openai-compatible">OpenAI-compatible / 自定义</option>
                </select>
              </Field>
              <Field
                label="2. Base URL"
                hint={form.embeddings.provider === "voyage" ? "官方地址由系统固定" : "填写兼容 OpenAI embeddings 接口的完整地址"}
              >
                <input
                  readOnly={form.embeddings.provider === "voyage"}
                  value={form.embeddings.baseUrl}
                  onChange={(event) => {
                    setEmbeddingModels([]);
                    updateEmbeddings({ baseUrl: event.target.value, apiKey: "", model: "" });
                  }}
                  className={cn(
                    inputClass,
                    form.embeddings.provider === "voyage" && "cursor-default text-slate-400",
                  )}
                />
              </Field>
              <Field label="3. API Key">
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={canReuseEmbeddingKey ? "已保存，留空沿用" : "必填"}
                    value={form.embeddings.apiKey}
                    onChange={(event) => {
                      setEmbeddingModels([]);
                      updateEmbeddings({
                        apiKey: event.target.value,
                        model: form.embeddings.provider === "voyage"
                          ? form.embeddings.model
                          : "",
                      });
                    }}
                    className={inputClass}
                  />
                  {form.embeddings.provider === "openai-compatible" && (
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      onClick={() => void discoverModels("embeddings")}
                      disabled={
                        modelsLoading !== null ||
                        !form.embeddings.baseUrl.trim() ||
                        (!form.embeddings.apiKey.trim() && !canReuseEmbeddingKey)
                      }
                      className="h-[31px] shrink-0 px-2 text-xs text-cyan-400"
                    >
                      {modelsLoading === "embeddings"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      获取模型
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="4. 模型">
                <select
                  value={form.embeddings.model}
                  onChange={(event) => updateEmbeddings({ model: event.target.value })}
                  disabled={embeddingOptions.length === 0}
                  className={cn(inputClass, embeddingOptions.length === 0 && "cursor-not-allowed text-slate-600")}
                >
                  {embeddingOptions.length === 0 && <option value="">请先获取模型</option>}
                  {embeddingOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </Field>
              <Field
                label="5. 索引维度"
                hint={`对应 EMBEDDINGS_DIMENSIONS；当前云端 PostgreSQL 向量列固定为 ${CLOUD_INDEX_DIMENSIONS} 维`}
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.embeddings.dimensions || ""}
                  onChange={(event) => updateEmbeddings({
                    dimensions: event.target.value === "" ? 0 : Number(event.target.value),
                  })}
                  className={inputClass}
                />
              </Field>
              <Field
                label="6. 供应商输出维度"
                hint={form.embeddings.provider === "voyage"
                  ? "Voyage 的 output_dimension；必须与索引维度一致"
                  : "OpenAI-compatible 接口由模型返回；系统会校验返回值为索引维度"}
              >
                {form.embeddings.provider === "voyage" ? (
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={form.embeddings.outputDimension ?? ""}
                    onChange={(event) => updateEmbeddings({
                      outputDimension: event.target.value === "" ? undefined : Number(event.target.value),
                    })}
                    className={inputClass}
                  />
                ) : (
                  <input
                    readOnly
                    value="由供应商接口返回"
                    className={cn(inputClass, "cursor-default text-slate-500")}
                  />
                )}
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">Rerank</h3>
              <p className="mt-1 text-[10px] text-slate-600">
                Rerank 可独立切换，不需要重建向量索引。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="1. 供应商">
                <select
                  value={form.rerank.provider}
                  onChange={(event) => {
                    const provider = event.target.value as RerankProvider;
                    const preset = RERANK_PROVIDER_PRESETS[provider];
                    setRerankModels([]);
                    updateRerank({
                      provider,
                      baseUrl: preset.baseUrl,
                      model: preset.models[0] || "",
                      apiKey: "",
                    });
                  }}
                  className={inputClass}
                >
                  {Object.entries(RERANK_PROVIDER_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="2. Base URL"
                hint={form.rerank.provider === "custom" ? "自定义服务需填写完整 rerank 接口地址" : "官方地址由系统固定"}
              >
                <input
                  readOnly={form.rerank.provider !== "custom"}
                  value={form.rerank.baseUrl}
                  onChange={(event) => {
                    setRerankModels([]);
                    updateRerank({ baseUrl: event.target.value, apiKey: "", model: "" });
                  }}
                  className={cn(
                    inputClass,
                    form.rerank.provider !== "custom" && "cursor-default text-slate-400",
                  )}
                />
              </Field>
              <Field label="3. API Key">
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={canReuseRerankKey ? "已保存，留空沿用" : "必填"}
                    value={form.rerank.apiKey}
                    onChange={(event) => {
                      setRerankModels([]);
                      updateRerank({
                        apiKey: event.target.value,
                        model: form.rerank.provider === "siliconflow-compatible"
                          ? ""
                          : form.rerank.model,
                      });
                    }}
                    className={inputClass}
                  />
                  {rerankPreset.dynamicModels && (
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      onClick={() => void discoverModels("rerank")}
                      disabled={
                        modelsLoading !== null ||
                        (!form.rerank.apiKey.trim() && !canReuseRerankKey)
                      }
                      className="h-[31px] shrink-0 px-2 text-xs text-cyan-400"
                    >
                      {modelsLoading === "rerank"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      获取模型
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="4. 模型">
                {form.rerank.provider === "custom" ? (
                  <input
                    value={form.rerank.model}
                    onChange={(event) => updateRerank({ model: event.target.value })}
                    placeholder="自定义服务模型名"
                    className={inputClass}
                  />
                ) : (
                  <select
                    value={form.rerank.model}
                    onChange={(event) => updateRerank({ model: event.target.value })}
                    disabled={rerankOptions.length === 0}
                    className={cn(inputClass, rerankOptions.length === 0 && "cursor-not-allowed text-slate-600")}
                  >
                    {rerankOptions.length === 0 && <option value="">请先获取模型</option>}
                    {rerankOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                )}
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      {notice && (
        <p className={cn("text-xs", noticeOk ? "text-emerald-400" : "text-red-400")}>
          {notice}
        </p>
      )}
      {!notice && validationError && <p className="text-xs text-amber-400">{validationError}</p>}

      <Button
        variant="glass"
        size="sm"
        onClick={() => void submit(false)}
        disabled={busy || modelsLoading !== null || Boolean(validationError)}
        className="text-xs text-cyan-400"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        保存平台配置
      </Button>

      <AlertDialog open={confirmReset} onOpenChange={(open) => !busy && setConfirmReset(open)}>
        <AlertDialogContent className="border-white/[0.08] bg-[#0d1424]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认切换 Embedding</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              新旧 Embedding 的向量空间不能混用。继续后会清除 Relay 和 LCE
              中的全部旧索引状态，所有项目都需要重新索引。此操作不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              className="border-white/[0.08] bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-white"
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void submit(true)}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              清除旧索引并保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
