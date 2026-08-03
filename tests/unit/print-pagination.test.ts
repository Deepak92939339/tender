import { describe, expect, it } from "vitest";
import { chunkPrintItems } from "../../components/quotes/issued-print-document";

describe("deterministic issued print pagination", () => {
  it("chunks a long 40-line quotation into stable pages", () => {
    const pages = chunkPrintItems(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(pages.map((page) => page.length)).toEqual([14, 14, 12]);
    expect(pages.flat()).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
  });

  it("retains one final page for an empty defensive input", () => {
    expect(chunkPrintItems([])).toEqual([[]]);
  });
});
