export const SIGNED_OUT_MESSAGE = "Signed out of Google. Sign in to this account again.";

/** Google's consent screen lets people untick Gmail access; every Gmail call then fails. */
export const GMAIL_ACCESS_MISSING_MESSAGE =
  "Otter isn't allowed to read this Gmail account. Sign in to it again and allow access to your mail.";

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.");
  }
}

/** The browser step was never finished: the user's to retry, not a failure to report. */
export class SignInTimedOutError extends Error {}
