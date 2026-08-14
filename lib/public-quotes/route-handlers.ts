import {
  createPublicBrokerInvoker,
  type PublicBrokerInvoker,
} from "./edge-client.ts";
import {
  clearPublicQuoteCookieHeader,
  decryptPublicQuoteCapability,
  encryptPublicQuoteCapability,
  PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS,
  publicQuoteCookieHeader,
  readPublicQuoteCookie,
} from "./session-cookie.ts";
import {
  parseActionRequest,
  parseSessionRequest,
  parseVerifyRequest,
  PublicRouteError,
  readBoundedJson,
  requireSameOrigin,
} from "./route-validation.ts";

type Dependencies = {
  broker: PublicBrokerInvoker;
  sessionSecret: string;
  secureCookies: boolean;
  now: () => number;
};

class PublicQuoteSessionError extends Error {
  constructor(
    readonly code:
      | "broker_configuration"
      | "broker_signing"
      | "broker_network"
      | "broker_response"
      | "broker_unknown"
      | "encryption",
  ) {
    super("The public quote session is unavailable.");
    this.name = "PublicQuoteSessionError";
  }
}

const TERMINAL_SESSION_STATUSES = new Set([
  "invalid_link",
  "revoked",
  "superseded",
  "expired",
  "accepted",
  "already_responded",
  "already_accepted",
  "stale",
]);

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function jsonResponse(status: number, body: unknown, setCookie?: string) {
  const headers = new Headers(responseHeaders);
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function noContent(setCookie: string) {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache",
      "set-cookie": setCookie,
      "x-content-type-options": "nosniff",
    },
  });
}

function routeError(error: PublicRouteError) {
  const status =
    error.code === "origin_required" || error.code === "origin_mismatch"
      ? 403
      : error.code === "content_type_required"
        ? 415
        : error.code === "body_too_large"
          ? 413
          : 400;
  return jsonResponse(status, { status: "invalid_request" }, undefined);
}

function runtimeDependencies(): Dependencies {
  const sessionSecret = process.env.TENDER_PUBLIC_SESSION_ENCRYPTION_KEY;
  if (!sessionSecret)
    throw new Error("The public quote session is unavailable.");
  return {
    broker: createPublicBrokerInvoker(),
    sessionSecret,
    secureCookies: process.env.NODE_ENV === "production",
    now: () => Math.floor(Date.now() / 1_000),
  };
}

function dependencies(value?: Dependencies) {
  return value ?? runtimeDependencies();
}

function internalFailure() {
  return jsonResponse(503, { status: "unavailable" });
}

function logInternalFailure(error: unknown) {
  const errorRecord =
    error !== null && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : null;
  const transportCode =
    errorRecord?.name === "EdgeBrokerTransportError" &&
    (errorRecord.code === "configuration" ||
      errorRecord.code === "signing" ||
      errorRecord.code === "network" ||
      errorRecord.code === "response")
      ? errorRecord.code
      : null;
  console.info(
    JSON.stringify({
      component: "public-quote-route",
      outcome: "internal_error",
      status:
        transportCode !== null
          ? `edge_transport_${transportCode}`
          : error instanceof PublicQuoteSessionError
            ? `session_${error.code}`
            : "public_quote_unavailable",
    }),
  );
}

export async function handlePublicQuoteSessionPost(
  request: Request,
  provided?: Dependencies,
) {
  const deps = dependencies(provided);
  try {
    requireSameOrigin(request);
    const input = parseSessionRequest(await readBoundedJson(request));
    let call;
    try {
      call = await deps.broker(
        "open",
        { action: "open", selector: input.selector, secret: input.secret },
        request.headers,
      );
    } catch (error) {
      const record =
        error !== null && typeof error === "object"
          ? (error as { name?: unknown; code?: unknown })
          : null;
      if (
        record !== null &&
        (record.code === "configuration" ||
          record.code === "signing" ||
          record.code === "network" ||
          record.code === "response")
      ) {
        throw new PublicQuoteSessionError(`broker_${record.code}`);
      }
      throw new PublicQuoteSessionError("broker_unknown");
    }
    if (!("value" in call.result)) {
      return jsonResponse(
        call.httpStatus,
        { status: call.result.status },
        TERMINAL_SESSION_STATUSES.has(call.result.status)
          ? clearPublicQuoteCookieHeader(deps.secureCookies)
          : undefined,
      );
    }
    const expiresAt = deps.now() + PUBLIC_QUOTE_COOKIE_MAX_AGE_SECONDS;
    let token: string;
    try {
      token = await encryptPublicQuoteCapability(
        {
          version: 1,
          selector: input.selector,
          secret: input.secret,
          expiresAt,
        },
        deps.sessionSecret,
      );
    } catch {
      throw new PublicQuoteSessionError("encryption");
    }
    return jsonResponse(
      200,
      call.result.value,
      publicQuoteCookieHeader(token, expiresAt, deps.secureCookies),
    );
  } catch (error) {
    if (error instanceof PublicRouteError) {
      return routeError(error);
    }
    logInternalFailure(error);
    return internalFailure();
  }
}

export async function handlePublicQuoteSessionDelete(
  request: Request,
  provided?: Dependencies,
) {
  const deps = dependencies(provided);
  try {
    requireSameOrigin(request);
    return noContent(clearPublicQuoteCookieHeader(deps.secureCookies));
  } catch (error) {
    if (error instanceof PublicRouteError) {
      return routeError(error);
    }
    return internalFailure();
  }
}

export async function handlePublicQuoteActionPost(
  request: Request,
  provided?: Dependencies,
) {
  const deps = dependencies(provided);
  try {
    requireSameOrigin(request);
    const input = parseActionRequest(await readBoundedJson(request));
    const token = readPublicQuoteCookie(request.headers);
    if (!token) {
      return jsonResponse(
        401,
        { status: "session_invalid" },
        clearPublicQuoteCookieHeader(deps.secureCookies),
      );
    }
    let capability;
    try {
      capability = await decryptPublicQuoteCapability(
        token,
        deps.sessionSecret,
        deps.now(),
      );
    } catch {
      return jsonResponse(
        401,
        { status: "session_invalid" },
        clearPublicQuoteCookieHeader(deps.secureCookies),
      );
    }
    const body = {
      ...input,
      selector: capability.selector,
      secret: capability.secret,
    };
    const call = await deps.broker(input.action, body, request.headers);
    const clearsOnSuccess =
      "value" in call.result &&
      (input.action === "accept" ||
        (input.action === "record_event" && input.eventType !== "viewed"));
    const clear =
      clearsOnSuccess ||
      (!("value" in call.result) &&
        TERMINAL_SESSION_STATUSES.has(call.result.status));
    if (!("value" in call.result)) {
      return jsonResponse(
        call.httpStatus,
        { status: call.result.status },
        clear ? clearPublicQuoteCookieHeader(deps.secureCookies) : undefined,
      );
    }
    return jsonResponse(
      200,
      call.result.value,
      clear ? clearPublicQuoteCookieHeader(deps.secureCookies) : undefined,
    );
  } catch (error) {
    if (error instanceof PublicRouteError) {
      return routeError(error);
    }
    return internalFailure();
  }
}

export async function handlePublicQuoteVerifyPost(
  request: Request,
  provided?: Dependencies,
) {
  const deps = dependencies(provided);
  try {
    requireSameOrigin(request);
    const input = parseVerifyRequest(await readBoundedJson(request));
    const call = await deps.broker(
      "verify",
      { action: "verify", verificationCode: input.verificationCode },
      request.headers,
    );
    return "value" in call.result
      ? jsonResponse(200, call.result.value)
      : jsonResponse(call.httpStatus, { status: call.result.status });
  } catch (error) {
    if (error instanceof PublicRouteError) {
      return routeError(error);
    }
    return internalFailure();
  }
}

export type PublicQuoteRouteDependencies = Dependencies;
