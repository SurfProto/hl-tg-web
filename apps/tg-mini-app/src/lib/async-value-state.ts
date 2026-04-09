export type AsyncValueState = "loading" | "error" | "ready";

export function getAsyncValueState({
  hasValue,
  isLoading,
  isError,
}: {
  hasValue: boolean;
  isLoading: boolean;
  isError: boolean;
}): AsyncValueState {
  if (hasValue) {
    return "ready";
  }

  if (isLoading) {
    return "loading";
  }

  if (isError) {
    return "error";
  }

  return "loading";
}
