import { toErrorBody } from "../../_lib/error-response";
import { HttpError } from "../../_lib/http-error";

export { HttpError };

export function json(response: any, statusCode: number, body: unknown) {
  response.status(statusCode).json(body);
}

export function parseJsonBody<T>(request: any): T {
  if (request.body == null || request.body === "") {
    return {} as T;
  }

  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body) as T;
    } catch {
      throw new HttpError(400, "BAD_REQUEST", "Request body is not valid JSON");
    }
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
    const { statusCode, body } = toErrorBody(error);
    json(response, statusCode, body);
  }
}
