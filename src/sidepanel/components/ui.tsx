/** Small presentational building blocks shared by the report sections. */
import type { CSSProperties, ReactNode } from "react";

export type Tone = "ok" | "warn" | "error" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  muted: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** A flag such as "nofollow", "empty alt" or "skipped level". */
export function Tag({ tone = "warn", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1 py-px text-[10px] font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-2 py-1">
      <span className="pt-px text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <div className="min-w-0 text-[11px] break-words">{children}</div>
    </div>
  );
}

/** A row in a list that scrolls to and flashes its element when clicked. */
export function ClickableRow({
  onClick,
  children,
  className = "",
  title,
  style,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={style}
      className={`block w-full cursor-pointer rounded px-2 py-1.5 text-left transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800 ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">{children}</p>
  );
}
