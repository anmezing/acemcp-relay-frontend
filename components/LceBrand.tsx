import Image from "next/image";
import { cn } from "@/lib/utils";

interface LceBrandProps {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  iconSize?: number;
  priority?: boolean;
  showName?: boolean;
}

export function LceBrand({
  className,
  iconClassName,
  textClassName,
  iconSize = 32,
  priority = false,
  showName = true,
}: LceBrandProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/lce-icon.svg"
        alt=""
        aria-hidden="true"
        width={iconSize}
        height={iconSize}
        priority={priority}
        className={cn("shrink-0", iconClassName)}
      />
      {showName && (
        <span
          className={cn(
            "font-semibold text-transparent bg-clip-text bg-gradient-to-r from-[#57d6c1] to-cyan-300",
            textClassName,
          )}
        >
          LCE
        </span>
      )}
    </span>
  );
}
