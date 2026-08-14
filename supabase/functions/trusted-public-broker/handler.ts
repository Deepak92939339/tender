import { projectBrokerResult } from "./projection.ts";
import { deriveRateLimitSubject } from "./rate-subject.ts";
import type { BrokerDatabase } from "./rpc.ts";
import {
  readBrokerRequest,
  RequestValidationError,
  type BrokerActionName,
} from "./validation.ts";

export type BrokerLogEntry = {
  component: "trusted-public-broker";
  requestId: string;
  action: BrokerActionName | "unresolved";
  outcome: "completed" | "rejected" | "internal_error";
  status: string;
};

type Dependencies = {
  database: BrokerDatabase;
  hmacSecret: string;
  log: (entry: BrokerLogEntry) => void;
  randomId?: () => string;
};

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function response(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders,
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}

function validationStatus(error: RequestValidationError) {
  if (error.code === "method_not_allowed") return 405;
  if (error.code === "body_too_large") return 413;
  if (error.code === "content_type_required") return 415;
  return 400;
}

function resultStatus(status: string) {
  switch (status) {
    case "ok":
      return 200;
    case "rate_limited":
      return 429;
    case "invalid_link":
    case "not_found":
      return 404;
    case "expired":
    case "revoked":
    case "superseded":
      return 410;
    case "idempotency_conflict":
    case "accepted":
    case "already_responded":
    case "already_accepted":
    case "stale":
      return 409;
    case "message_invalid":
    case "acceptance_evidence_invalid":
      return 400;
    default:
      return 500;
  }
}

export function createBrokerHandler(dependencies: Dependencies) {
  return async (request: Request) => {
    const requestId = dependencies.randomId
      ? dependencies.randomId()
      : crypto.randomUUID();
    let actionName: BrokerActionName | "unresolved" = "unresolved";
    try {
      const action = await readBrokerRequest(request);
      actionName = action.action;
      const subjectHash = await deriveRateLimitSubject(
        request,
        dependencies.hmacSecret,
      );
      const databaseResult = await dependencies.database.invoke(
        action,
        subjectHash,
      );
      const result = projectBrokerResult(action.action, databaseResult);
      dependencies.log({
        component: "trusted-public-broker",
        requestId,
        action: actionName,
        outcome: "completed",
        status: result.status,
      });
      return response(resultStatus(result.status), result, requestId);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        dependencies.log({
          component: "trusted-public-broker",
          requestId,
          action: actionName,
          outcome: "rejected",
          status: error.code,
        });
        return response(
          validationStatus(error),
          { status: "invalid_request", code: error.code },
          requestId,
          error.code === "method_not_allowed" ? { allow: "POST" } : {},
        );
      }
      dependencies.log({
        component: "trusted-public-broker",
        requestId,
        action: actionName,
        outcome: "internal_error",
        status: "broker_unavailable",
      });
      return response(
        503,
        { status: "unavailable", code: "broker_unavailable" },
        requestId,
      );
    }
  };
}
