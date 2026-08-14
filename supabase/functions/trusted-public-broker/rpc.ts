import type { BrokerAction } from "./validation.ts";

const MAX_DATABASE_RESPONSE_BYTES = 2_500_000;

export interface BrokerDatabase {
  invoke(action: BrokerAction, subjectHash: Uint8Array): Promise<unknown>;
}

export class BrokerDatabaseError extends Error {
  constructor() {
    super("The broker database invocation failed.");
    this.name = "BrokerDatabaseError";
  }
}

function rpcRequest(action: BrokerAction, subjectHash: string) {
  switch (action.action) {
    case "open":
      return {
        functionName: "broker_open_quote",
        body: {
          p_selector: action.selector,
          p_secret: action.secret,
          p_subject_hash: subjectHash,
        },
      };
    case "record_event":
      return {
        functionName: "broker_record_quote_event",
        body: {
          p_event_type: action.eventType,
          p_selector: action.selector,
          p_secret: action.secret,
          p_subject_hash: subjectHash,
          p_idempotency_key: action.idempotencyKey,
          p_message: action.message,
        },
      };
    case "accept":
      return {
        functionName: "broker_accept_quote",
        body: {
          p_selector: action.selector,
          p_secret: action.secret,
          p_subject_hash: subjectHash,
          p_idempotency_key: action.idempotencyKey,
          p_buyer_asserted_name: action.buyerAssertedName,
          p_buyer_asserted_title: action.buyerAssertedTitle,
          p_acceptance_statement_version: action.acceptanceStatementVersion,
        },
      };
    case "verify":
      return {
        functionName: "broker_verify_quote",
        body: {
          p_verification_code: action.verificationCode,
          p_subject_hash: subjectHash,
        },
      };
  }
}

function hex(bytes: Uint8Array) {
  return `\\x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function createRestBrokerDatabase(
  supabaseUrl: string,
  serviceRoleCredential: string,
  fetchImplementation: typeof fetch = fetch,
): BrokerDatabase {
  const baseUrl = new URL(supabaseUrl);
  const localHttpHosts = new Set([
    "127.0.0.1",
    "localhost",
    "kong",
    "host.docker.internal",
  ]);
  if (
    baseUrl.protocol !== "https:" &&
    !(baseUrl.protocol === "http:" && localHttpHosts.has(baseUrl.hostname))
  ) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }
  return {
    async invoke(action, subjectHash) {
      const rpc = rpcRequest(action, hex(subjectHash));
      let response: Response;
      try {
        response = await fetchImplementation(
          new URL(`/rest/v1/rpc/${rpc.functionName}`, baseUrl),
          {
            method: "POST",
            headers: {
              apikey: serviceRoleCredential,
              authorization: `Bearer ${serviceRoleCredential}`,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(rpc.body),
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
          },
        );
      } catch {
        throw new BrokerDatabaseError();
      }
      if (!response.ok) throw new BrokerDatabaseError();
      const declaredLength = response.headers.get("content-length");
      if (
        declaredLength !== null &&
        Number(declaredLength) > MAX_DATABASE_RESPONSE_BYTES
      ) {
        throw new BrokerDatabaseError();
      }
      const responseText = await response.text();
      if (
        new TextEncoder().encode(responseText).byteLength >
        MAX_DATABASE_RESPONSE_BYTES
      ) {
        throw new BrokerDatabaseError();
      }
      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new BrokerDatabaseError();
      }
    },
  };
}
