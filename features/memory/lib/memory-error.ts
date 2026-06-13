export function formatMemoryError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      error_code?: unknown;
      errorCode?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const code =
      typeof maybeError.error_code === "string"
        ? maybeError.error_code
        : typeof maybeError.errorCode === "string"
          ? maybeError.errorCode
          : null;

    if (typeof maybeError.message === "string" && maybeError.message.length > 0) {
      return code ? `${code}: ${maybeError.message}` : maybeError.message;
    }

    if (typeof maybeError.error === "string" && maybeError.error.length > 0) {
      return code ? `${code}: ${maybeError.error}` : maybeError.error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return "Unknown error";
}
