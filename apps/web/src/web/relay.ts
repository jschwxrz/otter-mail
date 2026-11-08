/**
 * The relay host whose sign-ins return to the host this page is on: otter.otterware.app's is
 * relay.otterware.app; mail.otterware.app (until the stable Worker redirects it) keeps its own.
 */
export const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ||
  (self.location.hostname === "mail.otterware.app"
    ? "https://relay.mail.otterware.app"
    : "https://relay.otterware.app");
