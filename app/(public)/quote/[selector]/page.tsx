import { RecipientQuoteClient } from "@/components/public-quotes/recipient-quote-client";

export default async function RecipientQuotePage({
  params,
}: {
  params: Promise<{ selector: string }>;
}) {
  const { selector } = await params;
  return <RecipientQuoteClient selector={selector} />;
}
