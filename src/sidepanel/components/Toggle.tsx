/** An accessible on/off switch used for the per-section highlight toggles. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-900 ${
        checked
          ? "border-blue-600 bg-blue-600"
          : "border-neutral-300 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800"
      }`}
    >
      {/* 28px track, 12px knob, 2px inset: travel is 12px, so the knob sits
          2px from whichever edge it is against. */}
      <span
        aria-hidden="true"
        className={`absolute left-0.5 h-3 w-3 rounded-full shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-3 bg-white" : "translate-x-0 bg-white"
        }`}
      />
    </button>
  );
}
