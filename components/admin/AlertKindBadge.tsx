import { cn } from "@/lib/utils";

const ALERT_KIND_LABELS: Record<string, { label: string; className: string }> = {
  device_evicted: { label: "设备互踢", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  multi_ip: { label: "多 IP", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  unregistered_device: { label: "未注册设备", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  missing_client_id: { label: "无设备标识", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

export function AlertKindBadge({ kind }: { kind: string }) {
  const meta = ALERT_KIND_LABELS[kind] || {
    label: kind,
    className: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap", meta.className)}>
      {meta.label}
    </span>
  );
}
