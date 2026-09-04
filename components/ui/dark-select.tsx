"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DarkSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DarkSelectProps {
  value: string;
  options: DarkSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
}

export function DarkSelect({
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "—",
  ariaLabel,
  className,
  triggerClassName,
}: DarkSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabledIndexes = useMemo(
    () => options.flatMap((option, index) => option.disabled ? [] : [index]),
    [options]
  );

  const openAt = (preferredIndex: number) => {
    if (disabled || enabledIndexes.length === 0) return;
    const index = options[preferredIndex]?.disabled
      ? enabledIndexes[0]
      : preferredIndex >= 0
        ? preferredIndex
        : enabledIndexes[0];
    setActiveIndex(index);
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const currentPosition = enabledIndexes.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? direction > 0 ? 0 : enabledIndexes.length - 1
      : (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => open ? setOpen(false) : openAt(selectedIndex)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openAt(selectedIndex);
            else moveActive(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            openAt(event.key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1) ?? -1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className={cn(
          "flex h-full min-h-[30px] w-full items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#0d1424] px-2.5 py-1.5 text-left text-xs text-slate-200 outline-none transition-colors",
          "hover:border-white/[0.14] focus-visible:border-cyan-500/50 disabled:cursor-not-allowed disabled:text-slate-600",
          triggerClassName
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && !disabled && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-white/[0.1] bg-[#0b1220] p-1 shadow-2xl shadow-black/50"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActiveIndex(event.key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1) ?? -1);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(activeIndex);
            } else if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              setOpen(false);
              if (event.key === "Escape") requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
        >
          {options.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onClick={() => choose(index)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 transition-colors",
                "hover:bg-cyan-500/10 hover:text-cyan-200 focus:bg-cyan-500/10 focus:text-cyan-200 focus:outline-none",
                option.value === value && "bg-cyan-500/10 text-cyan-300",
                option.disabled && "cursor-not-allowed opacity-40"
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
