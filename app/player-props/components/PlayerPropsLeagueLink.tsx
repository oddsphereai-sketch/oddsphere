"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function PlayerPropsLeagueLink({
  href,
  children,
  ...props
}: {
  href: string;
  children: ReactNode;
  className: string;
  "aria-current"?: "page";
  "aria-label": string;
}) {
  const router = useRouter();
  const prefetch = () => router.prefetch(href);

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
