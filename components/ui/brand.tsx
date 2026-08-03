import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Tender home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>Tender</span>
    </Link>
  );
}
