/**
 * The single HttpError class for every API route.
 *
 * This used to be defined twice — once in market/_lib/response.ts and once in
 * onramp/_lib/http.ts — which meant an error thrown by one module was not
 * `instanceof` the class the other module caught with. Auth failures raised by
 * onramp/_lib/auth.ts fell through the account routes' handler and surfaced as
 * 500 INTERNAL_ERROR instead of 401, so clients could never tell "log in again"
 * apart from "the server is broken". Both modules now re-export this class.
 */
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
