"use client";

export type Mode = "best" | "search";

type Props = {
  active: Mode;
  onChange: (next: Mode) => void;
};

export default function ModeToggle({ active, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex bg-gray-900 border border-gray-800 rounded-full p-1 shadow-inner"
    >
      <ModeButton
        label="Tonight's Best"
        isActive={active === "best"}
        onClick={() => onChange("best")}
      />
      <ModeButton
        label="Search & Filter"
        isActive={active === "search"}
        onClick={() => onChange("search")}
      />
    </div>
  );
}

function ModeButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={onClick}
      className={`px-4 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
        isActive
          ? "bg-violet-600 text-white shadow-[0_0_18px_rgba(167,139,250,0.35)]"
          : "text-gray-300 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
