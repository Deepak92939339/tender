import { randomUUID } from "node:crypto";

export function logMutationFailure(
  operation: string,
  error?: { code?: string | null },
) {
  const reference = `TND-${randomUUID().slice(0, 8).toUpperCase()}`;
  const safeCode =
    error?.code && /^[A-Za-z0-9_]{1,24}$/.test(error.code)
      ? ` code=${error.code}`
      : "";
  console.error(`[${reference}] ${operation} failed.${safeCode}`);
  return reference;
}

export function withReference(message: string, reference: string) {
  return `${message} Reference ${reference}.`;
}
