"use client";

import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  end: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
};

// Animates a number from 0 up to `end` once the element scrolls into view.
// SSR/initial render shows the final value so crawlers and no-JS users see
// the real number; on intersection the first RAF tick snaps to 0 and the
// ease-out cubic count-up runs over `duration` ms.
export default function CountUp({
  end,
  decimals = 0,
  suffix = "",
  duration = 1200,
}: CountUpProps) {
  const [value, setValue] = useState<number>(end);
  const elementRef = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const elapsed = now - start;
              const progress = Math.min(elapsed / duration, 1);
              // ease-out cubic
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(end * eased);
              if (progress < 1) {
                requestAnimationFrame(tick);
              } else {
                setValue(end);
              }
            };
            requestAnimationFrame(tick);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [end, duration]);

  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={elementRef}>
      {formatted}
      {suffix}
    </span>
  );
}
