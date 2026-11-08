/**
 * The made-up services `pnpm dev:fake` and `pnpm dev:desktop:fake` open on: a pretend Gmail (with
 * its Calendar), Outlook and Todoist that answer the app's own requests from seeded mailboxes
 * (@otter/shared/demo-mailboxes), so the app runs with no Google, Microsoft or Otter account and
 * no network. Their state is a file in the app's own files, so it changes as the app works.
 * Development only: both shells import this lazily, behind their dev switch.
 */
import type { Platform } from "../platform.js";
import { demoGoogleAuth, installFakeGmail } from "./gmail.js";
import { demoMicrosoftAuth, installFakeOutlook } from "./outlook.js";
import { FAKE_RELAY_URL } from "./relay.js";

export { FAKE_RELAY_URL };
/** For tests that drive one service alone. */
export { demoMicrosoftAuth, installFakeOutlook };

/** Wraps `fetch` with the fakes and returns `platform` signed in to them. */
export async function withFakeServices(platform: Platform): Promise<Platform> {
  await installFakeGmail(platform.files);
  await installFakeOutlook(platform.files);
  return {
    ...platform,
    google: demoGoogleAuth(),
    microsoft: demoMicrosoftAuth(),
    relayUrl: FAKE_RELAY_URL,
    connect: () => Promise.reject(new Error("The made-up mailbox can't connect to mail servers.")),
  };
}
