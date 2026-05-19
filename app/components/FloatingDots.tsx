// Subtle decorative floating violet dots — reinforces the dotted-O brand
// motif. Dot positions are deterministic (seeded PRNG) so SSR and client
// hydration produce identical output. CSS keyframes in globals.css handle
// the slow drift animation; four direction variants are assigned by index
// modulo 4 for visual variety.

type Dot = {
  top: number;
  left: number;
  size: number;
  delay: number;
  duration: number;
};

function makeRng(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function generateDots(count: number, seed: number): Dot[] {
  const rand = makeRng(seed);
  return Array.from({ length: count }, () => ({
    top: rand() * 100,
    left: rand() * 100,
    size: 2 + rand() * 4,
    delay: rand() * -20,
    duration: 15 + rand() * 10,
  }));
}

const DOTS_LARGE = generateDots(35, 42);
const DOTS_SMALL = generateDots(14, 99);

type Props = {
  density?: "large" | "small";
};

export default function FloatingDots({ density = "large" }: Props) {
  const dots = density === "large" ? DOTS_LARGE : DOTS_SMALL;
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      {dots.map((dot, i) => (
        <span
          key={i}
          className={`absolute rounded-full bg-violet-400/30 floating-dot floating-dot-${(i % 4) + 1}`}
          style={{
            top: `${dot.top}%`,
            left: `${dot.left}%`,
            width: `${dot.size}px`,
            height: `${dot.size}px`,
            animationDelay: `${dot.delay}s`,
            animationDuration: `${dot.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
