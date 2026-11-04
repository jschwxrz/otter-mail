import { afterAll, beforeAll, describe } from "vite-plus/test";

import {
  dockerAvailable,
  startGreenMail,
  type Container,
} from "../../../protocols/test/servers.ts";
import { providerScenario } from "./provider-scenario.ts";

const docker = dockerAvailable();

describe.skipIf(!docker)("IMAP provider on GreenMail (no mod-sequences)", () => {
  let container: Container;
  beforeAll(async () => {
    container = await startGreenMail();
  }, 300_000);
  afterAll(async () => {
    await container?.stop();
  });

  providerScenario(() => ({
    accountId: "alice@example.com",
    password: "secret",
    smtp: true,
    settings: {
      username: "alice@example.com",
      imap: { host: container.host, port: container.port(3993), security: "tls" },
      smtp: { host: container.host, port: container.port(3465), security: "tls" },
    },
  }));
});
