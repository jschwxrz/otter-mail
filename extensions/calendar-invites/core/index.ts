import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerInviteHandlers } from "./handlers.js";

export default {
  manifest,
  activate({ handle }) {
    registerInviteHandlers(handle);
  },
} satisfies CoreExtension;
