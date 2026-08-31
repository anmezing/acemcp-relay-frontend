"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CLOUD_VECTOR_DIMENSIONS,
  MAX_MODEL_PROVIDER_API_KEYS,
  EMBEDDING_PROVIDER_PRESETS,
  PROMPT_ENHANCER_PROVIDER_PRESETS,
} from "@/lib/model-provider-presets";
import { RERANK_PROVIDER_PRESETS, type RerankProvider } from "@/lib/rerank-providers";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type EmbeddingProvider = "openai-compatible" | "voyage";
type PromptEnhancerProvider = "openai-compatible" | "anthropic" | "gemini";
type ModelKind = "embeddings" | "rerank" | "promptEnhancer";
type NoticeTone = "pending" | "success" | "error";

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
  promptEnhancer: {
    enabled: boolean;
    provider: PromptEnhancerProvider;
    model: string;
    baseUrl: string;
    apiKey: string;
  };
}

interface ModelView {
  embeddings: Omit<ModelForm["embeddings"], "apiKey"> & { apiKeyConfigured: boolean; apiKeyCount: number };
  rerank: Omit<ModelForm["rerank"], "apiKey"> & { apiKeyConfigured: boolean; apiKeyCount: number };
  promptEnhancer: Omit<ModelForm["promptEnhancer"], "apiKey"> & { apiKeyConfigured: boolean; apiKeyCount: number };
}

const inputClass =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none font-mono";

function toForm(config: ModelView): ModelForm {
  const embeddings = { ...config.embeddings };
  const rerank = { ...config.rerank };
  const promptEnhancer = { ...config.promptEnhancer };
  delete (embeddings as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  delete (rerank as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  delete (promptEnhancer as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  if (embeddings.provider === "voyage" && embeddings.outputDimension === undefined) {
    embeddings.outputDimension = CLOUD_VECTOR_DIMENSIONS;
  }
  return {
    embeddings: { ...embeddings, apiKey: "" },
    rerank: { ...rerank, apiKey: "" },
    promptEnhancer: { ...promptEnhancer, apiKey: "" },
  };
}

function uniqueModels(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat().map((model) => model.trim()).filter(Boolean))];
}

function parseKeyInput(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((key) => key.trim()).filter(Boolean))];
}

function modelConfigPatch(kind: ModelKind, form: ModelForm) {
  const keys = parseKeyInput(form[kind].apiKey);
  return {
    [kind]: {
      ...form[kind],
      apiKey: keys[0] ?? "",
      apiKeys: keys,
    },
  };
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

function KeyPoolInput({ value, onChange, placeholder, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const t = useTranslations("AdminModels");
  const keys = value === "" ? [""] : value.split(/\r?\n/);
  const update = (index: number, next: string) => {
    const values = [...keys];
    values[index] = next;
    onChange(values.join("\n"));
  };
  return (
    <div className="min-w-0 flex-1 space-y-2">
      {keys.map((key, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="password"
            disabled={disabled}
            autoComplete="new-password"
            value={key}
            placeholder={index === 0 ? placeholder : "API Key"}
            onChange={(event) => update(index, event.target.value)}
            className={cn(inputClass, disabled && "cursor-not-allowed text-slate-600")}
          />
          {keys.length > 1 && (
            <Button
              type="button"
              disabled={disabled}
              variant="glass"
              size="icon"
              title={t("removeThisKey")}
              onClick={() => onChange(keys.filter((_, keyIndex) => keyIndex !== index).join("\n"))}
              className="h-[31px] w-[31px] shrink-0 text-slate-500 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        disabled={disabled}
        variant="glass"
        size="sm"
        title={t("addApiKey")}
        onClick={() => onChange(`${value}${value ? "\n" : ""}`)}
        className="h-7 px-2 text-[11px] text-cyan-400"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("addKey")}
      </Button>
    </div>
  );
}

export function AdminModelsTab() {
  const t = useTranslations("AdminModels");
  const [view, setView] = useState<ModelView | null>(null);
  const [form, setForm] = useState<ModelForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKind, setSavingKind] = useState<ModelKind | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("error");
  const [modelsLoading, setModelsLoading] = useState<ModelKind | null>(null);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [rerankModels, setRerankModels] = useState<string[]>([]);
  const [promptEnhancerModels, setPromptEnhancerModels] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = savingKind !== null;

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
      setPromptEnhancerModels([]);
      if (clearNotice) setNotice("");
    } catch (error) {
      if (signal?.aborted) return;
      setNotice(error instanceof Error ? error.message : t("failedToLoadTryAgain"));
      setNoticeTone("error");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

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

  const updatePromptEnhancer = useCallback((patch: Partial<ModelForm["promptEnhancer"]>) => {
    setForm((current) => current && {
      ...current,
      promptEnhancer: { ...current.promptEnhancer, ...patch },
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
  const canReusePromptEnhancerKey = Boolean(
    view &&
    form &&
    view.promptEnhancer.apiKeyConfigured &&
    form.promptEnhancer.provider === view.promptEnhancer.provider &&
    form.promptEnhancer.baseUrl.trim() === view.promptEnhancer.baseUrl,
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
          apiKey: parseKeyInput(target.apiKey)[0] ?? "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const models = Array.isArray(data.models)
        ? data.models.filter((model: unknown): model is string => typeof model === "string" && model.trim() !== "")
        : [];
      if (models.length === 0) throw new Error(t("theProviderReturnedNoAvailableModels"));
      if (kind === "embeddings") {
        setEmbeddingModels(models);
        updateEmbeddings({ model: models.includes(form.embeddings.model) ? form.embeddings.model : models[0] });
      } else if (kind === "rerank") {
        setRerankModels(models);
        updateRerank({ model: models.includes(form.rerank.model) ? form.rerank.model : models[0] });
      } else {
        setPromptEnhancerModels(models);
        updatePromptEnhancer({ model: models.includes(form.promptEnhancer.model) ? form.promptEnhancer.model : models[0] });
      }
      const kindLabel = kind === "embeddings" ? "Embedding" : kind === "rerank" ? "Rerank" : t("promptEnhancement");
      setNotice(t("loadedModels", { count: models.length, kind: kindLabel }));
      setNoticeTone("success");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setNotice(kind === "promptEnhancer"
        ? t("failedToLoadPromptEnhancerModelsUseManual", { p0: reason })
        : t("failedToLoadModels", { p0: reason }));
      setNoticeTone("error");
    } finally {
      setModelsLoading(null);
    }
  }, [form, updateEmbeddings, updatePromptEnhancer, updateRerank, t]);

  const submit = useCallback(async (kind: ModelKind, confirmEmbeddingReset: boolean) => {
    if (!form) return;
    setSavingKind(kind);
    setNotice(confirmEmbeddingReset
      ? t("switchingEmbeddingAndClearingIndexes")
      : t("validatingAndSavingModelConfiguration"));
    setNoticeTone("pending");
    try {
      const response = await fetch("/api/admin/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: kind,
          config: modelConfigPatch(kind, form),
          confirmEmbeddingReset,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (kind === "embeddings" && response.status === 409 && data.requiresEmbeddingReset) {
        setNotice("");
        setConfirmReset(true);
        return;
      }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!data.config) throw new Error(t("invalidModelConfigurationResponse"));
      setConfirmReset(false);
      const savedView = data.config as ModelView;
      const savedForm = toForm(savedView);
      setView(savedView);
      setForm((current) => {
        if (!current) return current;
        if (kind === "embeddings") return { ...current, embeddings: savedForm.embeddings };
        if (kind === "rerank") return { ...current, rerank: savedForm.rerank };
        return { ...current, promptEnhancer: savedForm.promptEnhancer };
      });
      if (kind === "embeddings") setEmbeddingModels([]);
      if (kind === "rerank") setRerankModels([]);
      if (kind === "promptEnhancer") setPromptEnhancerModels([]);
      const section = kind === "embeddings" ? "Embedding" : kind === "rerank" ? "Rerank" : t("promptEnhancement");
      setNotice(data.embeddingChanged
        ? t("configurationSavedAndOldIndexesClearedExisting")
        : t("sectionConfigurationSavedAndAppliedImmediately", { section }));
      setNoticeTone("success");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setNotice(t("failedToSave", { p0: reason }));
      setNoticeTone("error");
    } finally {
      setSavingKind(null);
    }
  }, [form, t]);

  const validationErrors = useMemo<Record<ModelKind, string>>(() => {
    const empty = { embeddings: "", rerank: "", promptEnhancer: "" };
    if (!form) return empty;
    const embeddingKeys = parseKeyInput(form.embeddings.apiKey);
    const rerankKeys = parseKeyInput(form.rerank.apiKey);
    const promptEnhancerKeys = parseKeyInput(form.promptEnhancer.apiKey);
    const embeddings = (() => {
      if (!form.embeddings.baseUrl.trim()) return t("enterTheEmbeddingBaseUrl");
      if (embeddingKeys.length === 0 && !canReuseEmbeddingKey) return t("enterAnEmbeddingApiKey");
      if (embeddingKeys.length > MAX_MODEL_PROVIDER_API_KEYS) return t("theEmbeddingKeyPoolSupportsUpTo", { p0: MAX_MODEL_PROVIDER_API_KEYS });
      if (form.embeddings.provider !== "voyage" && embeddingKeys.length > 1) return t("onlyVoyageEmbeddingSupportsMultipleKeys");
      if (!form.embeddings.model.trim()) return form.embeddings.provider === "openai-compatible"
        ? t("loadAndSelectAnEmbeddingModel")
        : t("selectAnEmbeddingModel");
      if (!Number.isSafeInteger(form.embeddings.dimensions) || form.embeddings.dimensions <= 0) return t("enterAValidEmbeddingIndexDimension");
      if (form.embeddings.dimensions !== CLOUD_VECTOR_DIMENSIONS) return t("cloudIndexesCurrentlyUseDimensionsChangingThe", {p0: CLOUD_VECTOR_DIMENSIONS});
      if (form.embeddings.provider === "voyage" && form.embeddings.outputDimension !== undefined && form.embeddings.outputDimension !== form.embeddings.dimensions) {
        return t("voyageOutputDimensionsMustMatchTheIndex", { p0: CLOUD_VECTOR_DIMENSIONS });
      }
      return "";
    })();
    const rerank = (() => {
      if (!form.rerank.baseUrl.trim()) return t("enterTheRerankBaseUrl");
      if (rerankKeys.length === 0 && !canReuseRerankKey) return t("enterARerankApiKey");
      if (rerankKeys.length > MAX_MODEL_PROVIDER_API_KEYS) return t("theRerankKeyPoolSupportsUpTo", { p0: MAX_MODEL_PROVIDER_API_KEYS });
      if (form.rerank.provider !== "voyage" && rerankKeys.length > 1) return t("onlyVoyageRerankSupportsMultipleKeys");
      if (!form.rerank.model.trim()) return form.rerank.provider === "siliconflow-compatible"
        ? t("loadAndSelectARerankModel")
        : t("selectOrEnterARerankModel");
      return "";
    })();
    const promptEnhancer = (() => {
      if (!form.promptEnhancer.enabled) return "";
      if (!form.promptEnhancer.baseUrl.trim()) return t("enterThePromptEnhancerBaseUrl");
      if (promptEnhancerKeys.length === 0 && !canReusePromptEnhancerKey) return t("enterAPromptEnhancerApiKey");
      if (promptEnhancerKeys.length > MAX_MODEL_PROVIDER_API_KEYS) return t("thePromptEnhancerKeyPoolSupportsUpTo", { p0: MAX_MODEL_PROVIDER_API_KEYS });
      if (!form.promptEnhancer.model.trim()) return t("enterOrSelectAPromptEnhancerModel");
      return "";
    })();
    return { embeddings, rerank, promptEnhancer };
  }, [canReuseEmbeddingKey, canReusePromptEnhancerKey, canReuseRerankKey, form, t]);

  if (loading) return <Skeleton className="h-72 rounded-xl bg-white/[0.06]" />;
  if (!form || !view) {
    return <p className="text-sm text-red-400">{notice || t("failedToLoadModelConfiguration")}</p>;
  }

  const rerankPreset = RERANK_PROVIDER_PRESETS[form.rerank.provider];
  const embeddingOptions = uniqueModels(
    form.embeddings.provider === "voyage" ? [...EMBEDDING_PROVIDER_PRESETS.voyage.models] : [],
    embeddingModels,
    [form.embeddings.model],
  );
  const rerankOptions = uniqueModels(
    [...rerankPreset.models],
    rerankModels,
    [form.rerank.model],
  );
  const promptEnhancerOptions = uniqueModels(
    promptEnhancerModels,
    [form.promptEnhancer.model],
  );

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500">
        {t("configurationIsStoredInTheLceDatabase")}
      </p>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">Embeddings</h3>
              <p className="mt-1 text-[10px] text-slate-600">
                {t("changingEmbeddingClearsOldVectorIndexesTo")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("1Provider")}>
                <select
                  value={form.embeddings.provider}
                  onChange={(event) => {
                    const provider = event.target.value as EmbeddingProvider;
                    setEmbeddingModels([]);
                    updateEmbeddings({
                      provider,
                      baseUrl: provider === "voyage" ? EMBEDDING_PROVIDER_PRESETS.voyage.baseUrl : "",
                      model: provider === "voyage" ? EMBEDDING_PROVIDER_PRESETS.voyage.models[0] : "",
                      apiKey: "",
                      dimensions: CLOUD_VECTOR_DIMENSIONS,
                      outputDimension: provider === "voyage" ? CLOUD_VECTOR_DIMENSIONS : undefined,
                      outputDtype: provider === "voyage" ? "float" : undefined,
                    });
                  }}
                  className={inputClass}
                >
                  <option value="voyage">Voyage AI</option>
                  <option value="openai-compatible">OpenAI-compatible / {t("custom")}</option>
                </select>
              </Field>
              <Field
                label="2. Base URL"
                hint={form.embeddings.provider === "voyage" ? t("theOfficialEndpointIsFixedByThe") : t("enterTheFullUrlOfAnOpenai")}
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
              <Field
                label={form.embeddings.provider === "voyage" ? t("3ApiKeyPool") : "3. API Key"}
                hint={form.embeddings.provider === "voyage"
                  ? t("oneKeyPerRowWithRotationAnd", {p0: view.embeddings.apiKeyCount})
                  : undefined}
              >
                <div className="flex gap-2">
                  {form.embeddings.provider === "voyage" ? <KeyPoolInput
                    placeholder={canReuseEmbeddingKey ? t("savedLeaveBlankToReuse", {p0: view.embeddings.apiKeyCount}) : t("oneVoyageApiKeyPerRow")}
                    value={form.embeddings.apiKey}
                    onChange={(value) => {
                      setEmbeddingModels([]);
                      updateEmbeddings({
                        apiKey: value,
                        model: form.embeddings.provider === "voyage"
                          ? form.embeddings.model
                          : "",
                      });
                    }}
                  /> : <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={canReuseEmbeddingKey ? t("savedLeaveBlankToReuse2") : t("required")}
                    value={form.embeddings.apiKey}
                    onChange={(event) => updateEmbeddings({ apiKey: event.target.value, model: "" })}
                    className={inputClass}
                  />}
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
                      {t("loadModels")}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t("4Model")}>
                <select
                  value={form.embeddings.model}
                  onChange={(event) => updateEmbeddings({ model: event.target.value })}
                  disabled={embeddingOptions.length === 0}
                  className={cn(inputClass, embeddingOptions.length === 0 && "cursor-not-allowed text-slate-600")}
                >
                  {embeddingOptions.length === 0 && <option value="">{t("loadModelsFirst")}</option>}
                  {embeddingOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </Field>
              <Field
                label={t("5IndexDimension")}
                hint={t("mapsToEmbeddingsDimensionsTheCloudPostgresql", {p0: CLOUD_VECTOR_DIMENSIONS})}
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
                label={t("6ProviderOutputDimension")}
                hint={form.embeddings.provider === "voyage"
                  ? t("voyageOutputDimensionItMustMatchThe")
                  : t("returnedByTheOpenaiCompatibleModelThe")}
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
                    value={t("returnedByProvider")}
                    className={cn(inputClass, "cursor-default text-slate-500")}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-col items-start gap-2 border-t border-white/[0.06] pt-4">
              {validationErrors.embeddings && <p className="text-xs text-amber-400">{validationErrors.embeddings}</p>}
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={() => void submit("embeddings", false)}
                disabled={busy || modelsLoading !== null || Boolean(validationErrors.embeddings)}
                className="text-xs text-cyan-400"
              >
                {savingKind === "embeddings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("saveEmbeddingConfiguration")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/[0.06] bg-[#0a0f1a]/60">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">Rerank</h3>
              <p className="mt-1 text-[10px] text-slate-600">
                {t("rerankCanBeChangedIndependentlyWithoutRebuilding")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("1Provider")}>
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
                hint={form.rerank.provider === "custom" ? t("enterTheCompleteRerankEndpointUrlFor") : t("theOfficialEndpointIsFixedByThe")}
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
              <Field
                label={form.rerank.provider === "voyage" ? t("3ApiKeyPool") : "3. API Key"}
                hint={form.rerank.provider === "voyage"
                  ? t("oneKeyPerRowWithRotationAnd", {p0: view.rerank.apiKeyCount})
                  : undefined}
              >
                <div className="flex gap-2">
                  {form.rerank.provider === "voyage" ? <KeyPoolInput
                    placeholder={canReuseRerankKey ? t("savedLeaveBlankToReuse", {p0: view.rerank.apiKeyCount}) : t("oneVoyageApiKeyPerRow")}
                    value={form.rerank.apiKey}
                    onChange={(value) => {
                      setRerankModels([]);
                      updateRerank({
                        apiKey: value,
                        model: form.rerank.provider === "siliconflow-compatible"
                          ? ""
                          : form.rerank.model,
                      });
                    }}
                  /> : <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={canReuseRerankKey ? t("savedLeaveBlankToReuse2") : t("required")}
                    value={form.rerank.apiKey}
                    onChange={(event) => {
                      setRerankModels([]);
                      updateRerank({ apiKey: event.target.value, model: "" });
                    }}
                    className={inputClass}
                  />}
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
                      {t("loadModels")}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t("4Model")}>
                {form.rerank.provider === "custom" ? (
                  <input
                    value={form.rerank.model}
                    onChange={(event) => updateRerank({ model: event.target.value })}
                    placeholder={t("customServiceModelName")}
                    className={inputClass}
                  />
                ) : (
                  <select
                    value={form.rerank.model}
                    onChange={(event) => updateRerank({ model: event.target.value })}
                    disabled={rerankOptions.length === 0}
                    className={cn(inputClass, rerankOptions.length === 0 && "cursor-not-allowed text-slate-600")}
                  >
                    {rerankOptions.length === 0 && <option value="">{t("loadModelsFirst")}</option>}
                    {rerankOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                )}
              </Field>
            </div>
            <div className="flex flex-col items-start gap-2 border-t border-white/[0.06] pt-4">
              {validationErrors.rerank && <p className="text-xs text-amber-400">{validationErrors.rerank}</p>}
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={() => void submit("rerank", false)}
                disabled={busy || modelsLoading !== null || Boolean(validationErrors.rerank)}
                className="text-xs text-cyan-400"
              >
                {savingKind === "rerank" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("saveRerankConfiguration")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/[0.06] bg-[#0a0f1a]/60 xl:col-span-2">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-white">{t("promptEnhancement")}</h3>
                <p className="mt-1 text-[10px] text-slate-600">
                  {t("promptEnhancementUsesRetrievedCodeContext")}
                </p>
              </div>
              <label htmlFor="prompt-enhancer-enabled" className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                <Checkbox
                  id="prompt-enhancer-enabled"
                  checked={form.promptEnhancer.enabled}
                  onCheckedChange={(checked) => updatePromptEnhancer({ enabled: checked === true })}
                />
                {t("enabled")}
              </label>
            </div>
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
              <Field label={t("1Provider")}>
                <select
                  value={form.promptEnhancer.provider}
                  disabled={!form.promptEnhancer.enabled}
                  onChange={(event) => {
                    const provider = event.target.value as PromptEnhancerProvider;
                    setPromptEnhancerModels([]);
                    updatePromptEnhancer({
                      provider,
                      baseUrl: PROMPT_ENHANCER_PROVIDER_PRESETS[provider].baseUrl,
                      apiKey: "",
                      model: "",
                    });
                  }}
                  className={cn(inputClass, !form.promptEnhancer.enabled && "cursor-not-allowed text-slate-600")}
                >
                  {Object.entries(PROMPT_ENHANCER_PROVIDER_PRESETS).map(([provider, preset]) => (
                    <option key={provider} value={provider}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="2. Base URL" hint={t("enterThePromptEnhancerEndpointForTheSelectedProvider")}>
                <input
                  disabled={!form.promptEnhancer.enabled}
                  value={form.promptEnhancer.baseUrl}
                  placeholder={form.promptEnhancer.provider === "openai-compatible"
                    ? "https://api.example.com/v1/chat/completions"
                    : PROMPT_ENHANCER_PROVIDER_PRESETS[form.promptEnhancer.provider].baseUrl}
                  onChange={(event) => {
                    setPromptEnhancerModels([]);
                    updatePromptEnhancer({ baseUrl: event.target.value, apiKey: "", model: "" });
                  }}
                  className={cn(inputClass, !form.promptEnhancer.enabled && "cursor-not-allowed text-slate-600")}
                />
              </Field>
              <Field
                label={t("3ApiKeyPool")}
                hint={t("oneKeyPerRowWithRotationAnd", {p0: view.promptEnhancer.apiKeyCount})}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <KeyPoolInput
                    disabled={!form.promptEnhancer.enabled}
                    placeholder={canReusePromptEnhancerKey
                      ? t("savedLeaveBlankToReuse", {p0: view.promptEnhancer.apiKeyCount})
                      : t("oneApiKeyPerRow")}
                    value={form.promptEnhancer.apiKey}
                    onChange={(value) => {
                      setPromptEnhancerModels([]);
                      updatePromptEnhancer({ apiKey: value, model: "" });
                    }}
                  />
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    onClick={() => void discoverModels("promptEnhancer")}
                    disabled={
                      !form.promptEnhancer.enabled ||
                      modelsLoading !== null ||
                      !form.promptEnhancer.baseUrl.trim() ||
                      (!form.promptEnhancer.apiKey.trim() && !canReusePromptEnhancerKey)
                    }
                    className="h-[31px] w-full shrink-0 px-2 text-xs text-cyan-400 sm:w-auto"
                  >
                    {modelsLoading === "promptEnhancer"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("loadModels")}
                  </Button>
                </div>
              </Field>
              <Field label={t("4Model")} hint={t("promptEnhancerModelCanBeEnteredManually")}>
                <input
                  type="text"
                  list="prompt-enhancer-model-options"
                  autoComplete="off"
                  value={form.promptEnhancer.model}
                  onChange={(event) => updatePromptEnhancer({ model: event.target.value })}
                  disabled={!form.promptEnhancer.enabled}
                  placeholder={t("enterOrSelectModel")}
                  className={cn(
                    inputClass,
                    !form.promptEnhancer.enabled && "cursor-not-allowed text-slate-600",
                  )}
                />
                <datalist id="prompt-enhancer-model-options">
                  {promptEnhancerOptions.map((model) => <option key={model} value={model} />)}
                </datalist>
              </Field>
            </div>
            <div className="flex flex-col items-start gap-2 border-t border-white/[0.06] pt-4">
              {validationErrors.promptEnhancer && <p className="text-xs text-amber-400">{validationErrors.promptEnhancer}</p>}
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={() => void submit("promptEnhancer", false)}
                disabled={busy || modelsLoading !== null || Boolean(validationErrors.promptEnhancer)}
                className="text-xs text-cyan-400"
              >
                {savingKind === "promptEnhancer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("savePromptEnhancerConfiguration")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {notice && (
        <p className={cn(
          "text-xs",
          noticeTone === "success" && "text-emerald-400",
          noticeTone === "pending" && "text-cyan-400",
          noticeTone === "error" && "text-red-400",
        )}>
          {notice}
        </p>
      )}

      <AlertDialog open={confirmReset} onOpenChange={(open) => !busy && setConfirmReset(open)}>
        <AlertDialogContent className="border-white/[0.08] bg-[#0d1424]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{t("changeEmbedding")}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t("oldAndNewEmbeddingVectorSpacesCannot")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              className="border-white/[0.08] bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-white"
            >
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void submit("embeddings", true)}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              {savingKind === "embeddings" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("clearOldIndexesAndSave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
