"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function PlayerPropsLeagueLink({
  href,
  prefetchOnMount = false,
  children,
  ...props
}: {
  href: string;
  prefetchOnMount?: boolean;
  children: ReactNode;
  className: string;
  "aria-current"?: "page";
  "aria-label": string;
}) {
  const router = useRouter();
  const prefetch = () => router.prefetch(href);

  useEffect(() => {
    if (prefetchOnMount) router.prefetch(href);
  }, [href, prefetchOnMount, router]);

  return (
    <Link
      {...props}
      href={href}
      onPointerEnter={prefetch}
      onFocus={prefetch}
    >
      {children}
    </Link>
  );
}
