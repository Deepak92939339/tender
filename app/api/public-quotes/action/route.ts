import { handlePublicQuoteActionPost } from "@/lib/public-quotes/route-handlers.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePublicQuoteActionPost(request);
}
