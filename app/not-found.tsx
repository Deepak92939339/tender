import Link from "next/link";
import { Brand } from "@/components/ui/brand";

export default function NotFound() {
  return (
    <main id="main-content" className="not-found">
      <Brand />
      <p className="eyebrow">404</p>
      <h1>This page is not part of Tender.</h1>
      <p>The address may be old or incomplete.</p>
      <Link className="button" href="/">
        Return home
      </Link>
    </main>
  );
}
