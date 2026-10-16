/** A row of single-select filter chips. */
export interface Chip<T extends string> {
  id: T;
  label: string;
  /** Shown next to the label, e.g. a count. */
  count?: number;
}

export function ChipRow<T extends string>({
  chips,
  value,
  onChange,
  label,
}: {
  chips: Chip<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800"
    >
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.id)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
              active
                ? "bg-blue-600 text-white"
                : "bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}
          >
            {chip.label}
            {chip.count !== undefined && (
              <span className={active ? "text-blue-100" : "opacity-70"}> {chip.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
