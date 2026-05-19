export default function SectionDivider() {
  return (
    <div
      className="flex items-center justify-center mt-12 sm:mt-16"
      aria-hidden="true"
    >
      <div className="h-px w-24 sm:w-40 bg-gradient-to-r from-transparent via-violet-500/40 to-transparent"></div>
      <span className="mx-3 text-violet-400/60 text-sm">✦</span>
      <div className="h-px w-24 sm:w-40 bg-gradient-to-r from-transparent via-violet-500/40 to-transparent"></div>
    </div>
  );
}
