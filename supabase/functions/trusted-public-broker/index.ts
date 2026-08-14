import { createBrokerHandler } from "./handler.ts";
import { createRestBrokerDatabase } from "./rpc.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function requiredEdgeSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value)
    throw new Error(`Required Edge runtime secret is missing: ${name}.`);
  return value;
}

const database = createRestBrokerDatabase(
  requiredEdgeSecret("SUPABASE_URL"),
  requiredEdgeSecret("SUPABASE_SERVICE_ROLE_KEY"),
);

const handler = createBrokerHandler({
  database,
  hmacSecret: requiredEdgeSecret("PUBLIC_BROKER_RATE_LIMIT_HMAC_SECRET"),
  log(entry) {
    console.info(JSON.stringify(entry));
  },
});

Deno.serve(handler);
