"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ModelSide {
  provider: string;
  model: string;
  baseUrl: string;
}

function ModelCard({ title, side }: { title: string; side: ModelSide }) {
  const rows = [
    { label: "Provider", value: side.provider },
    { label: "Model", value: side.model },
    { label: "Base URL", value: side.baseUrl },
  ];
  return (
    <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
      <CardContent className="p-4 space-y-2">
        <h3 className="text-white text-sm font-medium mb-3">{title}</h3>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="text-slate-500 text-xs w-20 shrink-0">{r.label}</span>
            <span className="text-slate-300 text-xs font-mono truncate">
              {r.value || <span className="text-slate-600">未配置</span>}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminModelsTab() {
  const [models, setModels] = useState<{ embeddings: ModelSide; rerank: ModelSide } | null>(null);
  const [byoModels, setByoModels] = useState<{ enabled: boolean; customModelUsers: number } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setModels(data.models);
      setByoModels(data.byoModels || null);
      setError("");
    } catch {
      setError("加载失败，请重试");
    }
  }, []);

  useEffect(() => {
    // 经微任务回调调用以满足 react-hooks/set-state-in-effect
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) load();
    });
    return () => {
      ignore = true;
    };
  }, [load]);

  if (!models && !error) {
    return <Skeleton className="h-48 bg-white/[0.06] rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {byoModels && (
        <p className="text-slate-400 text-xs">
          按用户自定义模型（BYO）：
          {byoModels.enabled
            ? <span className="text-cyan-400">已启用，{byoModels.customModelUsers} 位用户使用自定义配置</span>
            : <span className="text-slate-500">未启用（需设置 MODEL_CONFIG_SECRET）</span>}
          。以下为平台默认模型（未自定义的用户使用）：
        </p>
      )}
      {models && (
        <div className="grid md:grid-cols-2 gap-4">
          <ModelCard title="Embeddings" side={models.embeddings} />
          <ModelCard title="Rerank" side={models.rerank} />
        </div>
      )}
      <p className="text-slate-600 text-xs leading-relaxed">
        模型由 LCE 容器的环境变量决定（API Key 不在此展示）。修改方式：编辑服务器上
        deploy/.env 中的 EMBEDDINGS_* / RERANK_* 变量后执行
        docker compose up -d lce frontend 重启生效。切换 embedding
        模型后已有索引需要重建（维度/语义空间变化）。
      </p>
    </div>
  );
}
