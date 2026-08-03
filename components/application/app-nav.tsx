"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  ["/quotes", "Quotes"],
  ["/approvals", "Approvals"],
  ["/catalog", "Catalog"],
  ["/customers", "Customers"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="Application">
      {destinations.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || pathname?.startsWith(`${href}/`)
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
