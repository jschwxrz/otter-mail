import { isSupportFailure, supportError, type SupportError } from "@otter/shared/support";

const errors: SupportError[] = [];

/** Only classified summaries are retained, even before the user opens a report. */
export function recordSupportError(
  level: string,
  scope: string,
  message: string,
  data?: unknown,
): void {
  if (!isSupportFailure(level, message)) return;
  let detail = "";
  const error = data && typeof data === "object" && "error" in data ? data.error : data;
  try {
    detail =
      error instanceof Error ? (error.stack ?? error.message) : (JSON.stringify(error) ?? "");
  } catch {
    /* A logger must never break the operation it describes. */
  }
  const recorded = supportError(new Date().toISOString(), scope, `${message} ${detail}`);
  if (recorded) errors.push(recorded);
  if (errors.length > 50) errors.shift();
}

export const recentSupportErrors = (): SupportError[] => [...errors];
