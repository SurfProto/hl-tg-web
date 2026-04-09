export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function json(response: any, statusCode: number, body: unknown) {
  response.status(statusCode).json(body);
}

export function parseJsonBody<T>(request: any): T {
  if (request.body == null || request.body === "") {
    return {} as T;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body) as T;
  }

  return request.body as T;
}

export function ensureMethod(request: any, expectedMethod: string) {
  if (request.method !== expectedMethod) {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", `Expected ${expectedMethod}`);
  }
}

export async function withJsonRoute(request: any, response: any, handler: () => Promise<void>) {
  try {
    await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      json(response, error.statusCode, {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details ?? null,
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected server error";
    json(response, 500, {
      success: false,
      error: message,
      code: "INTERNAL_ERROR",
      details: null,
    });
  }
}
