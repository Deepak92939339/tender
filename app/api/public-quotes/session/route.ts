import {
  handlePublicQuoteSessionDelete,
  handlePublicQuoteSessionPost,
} from "@/lib/public-quotes/route-handlers.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePublicQuoteSessionPost(request);
}

export async function DELETE(request: Request) {
  return handlePublicQuoteSessionDelete(request);
}
