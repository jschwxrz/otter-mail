import { afterAll, beforeAll, describe } from "vite-plus/test";

import { dockerAvailable, startDovecot, type Container } from "../../../protocols/test/servers.ts";
import { providerScenario } from "./provider-scenario.ts";

const docker = dockerAvailable();

describe.skipIf(!docker)("IMAP provider on Dovecot (QRESYNC)", () => {
  let container: Container;
  beforeAll(async () => {
    container = await startDovecot();
  }, 300_000);
  afterAll(async () => {
    await container?.stop();
  });

  providerScenario(() => ({
    accountId: "ann@example.com",
    password: "pass",
    smtp: false,
    settings: {
      username: "ann@example.com",
      imap: { host: container.host, port: container.port(31993), security: "tls" },
      smtp: { host: container.host, port: 1, security: "tls" },
    },
  }));
});
