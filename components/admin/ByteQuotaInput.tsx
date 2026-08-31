"use client";

import {
  BYTE_UNIT_OPTIONS,
  ByteQuotaDraft,
  ByteUnit,
} from "@/lib/byte-units";
import { cn } from "@/lib/utils";

interface ByteQuotaInputProps {
  value: ByteQuotaDraft;
  onChange: (value: ByteQuotaDraft) => void;
  amountLabel: string;
  unitLabel: string;
  placeholder?: string;
  title?: string;
  compact?: boolean;
  className?: string;
  disabled?: boolean;
}

export function ByteQuotaInput({
  value,
  onChange,
  amountLabel,
  unitLabel,
  placeholder,
  title,
  compact = false,
  className,
  disabled = false,
}: ByteQuotaInputProps) {
  const controlClass = compact
    ? "h-7 text-xs"
    : "h-9 text-xs";

  return (
    <div
      className={cn(
        "flex min-w-0 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.03] focus-within:border-cyan-500/40",
        className
      )}
      title={title}
    >
      <input
        value={value.amount}
        onChange={(event) =>
          onChange({ ...value, amount: event.target.value })
        }
        inputMode="decimal"
        placeholder={placeholder}
        aria-label={amountLabel}
        disabled={disabled}
        className={cn(
          "min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-slate-200 outline-none placeholder:text-slate-600 disabled:opacity-50",
          controlClass
        )}
      />
      <select
        value={value.unit}
        onChange={(event) =>
          onChange({ ...value, unit: event.target.value as ByteUnit })
        }
        aria-label={unitLabel}
        disabled={disabled}
        className={cn(
          "border-l border-white/[0.08] bg-[#0d1422] px-1.5 font-mono text-slate-300 outline-none disabled:opacity-50",
          controlClass
        )}
      >
        {BYTE_UNIT_OPTIONS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    </div>
  );
}
