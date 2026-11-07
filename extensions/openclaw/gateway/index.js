import { randomUUID } from "node:crypto";
import {
  createChannelPluginBase,
  createChatChannelPlugin,
  defineChannelPluginEntry,
} from "openclaw/plugin-sdk/channel-core";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/agent-runtime";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import { createBrowserControl } from "./control.js";
import { readWorkspaceFile } from "./files.js";
import { accountOf, inboxKey, OTTER_TARGET, pointerOf, tell } from "./otter.js";

async function deliver(ctx, payload) {
  const account = accountOf(ctx.cfg);
  const pointer = pointerOf({ sessionKey: ctx.sessionKey, payload });
  await tell(account, pointer, { signal: ctx.signal });
  return { channel: "otter", messageId: randomUUID(), timestamp: pointer.at };
}

export const otterChannel = createChatChannelPlugin({
  base: {
    ...createChannelPluginBase({
      id: "otter",
      meta: { label: "Otter", blurb: "Send what your agents want you to see to Otter." },
      capabilities: { chatTypes: ["direct"] },
      config: {
        listAccountIds: (cfg) => (cfg?.channels?.otter ? ["default"] : []),
        resolveAccount: (cfg) => accountOf(cfg),
        inspectAccount: (cfg) => {
          const account = accountOf(cfg);
          return {
            enabled: account.enabled,
            configured: Boolean(cfg?.channels?.otter),
            tokenStatus: account.token ? "available" : "missing",
          };
        },
      },
    }),
    messaging: {
      targetResolver: { looksLikeId: () => true, hint: `"${OTTER_TARGET}"` },
      // Every delivery to Otter lands in the agent's Otter session, whatever the gateway's DM scope.
      resolveOutboundSessionRoute: ({ agentId }) => ({
        sessionKey: inboxKey(agentId),
        baseSessionKey: inboxKey(agentId),
        recipientSessionExact: true,
        peer: { kind: "direct", id: OTTER_TARGET },
        chatType: "direct",
        from: "otter",
        to: OTTER_TARGET,
      }),
    },
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget: () => ({ ok: true, to: OTTER_TARGET }),
    sendText: (ctx) => deliver(ctx),
    sendPayload: (ctx) => deliver(ctx, ctx.payload),
  },
});

export default defineChannelPluginEntry({
  id: "otter",
  name: "Otter",
  description: "Send what your agents want you to see to Otter.",
  plugin: otterChannel,
  registerFull(api) {
    // Otter's preview of a file an agent linked: PDFs and other files sessions.files.get won't send.
    api.registerGatewayMethod(
      "otter.files.get",
      async ({ params, context }) => {
        const { sessionKey, path } = params ?? {};
        if (typeof sessionKey !== "string" || typeof path !== "string" || !path)
          throw new Error("sessionKey and path are required");
        const cfg = context?.getRuntimeConfig?.() ?? api.config;
        const workspace = resolveAgentWorkspaceDir(cfg, resolveAgentIdFromSessionKey(sessionKey));
        return { file: await readWorkspaceFile(workspace, path) };
      },
      { scope: "operator.read" },
    );

    // Take control of the agent's browser from Otter: your input goes to the tab as a person's
    // would, and the agent's browser waits until you hand it back.
    const control = createBrowserControl({
      async cdpUrlFor(profile) {
        const result = await dispatchGatewayMethod("browser.request", {
          method: "GET",
          path: "/profiles",
        });
        if (!result?.ok)
          throw new Error(result?.error?.message ?? "Couldn't find the agent's browser.");
        const profiles = result.payload?.profiles ?? [];
        const found = profiles.find((p) => (profile ? p.name === profile : p.isDefault));
        const url = typeof found?.cdpUrl === "string" ? URL.parse(found.cdpUrl) : null;
        if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
          throw new Error("This browser can't be controlled from Otter.");
        return url.href;
      },
    });
    const targetOf = (params) => {
      if (typeof params?.targetId !== "string" || !params.targetId)
        throw new Error("targetId is required");
      return params.targetId;
    };
    api.registerGatewayMethod(
      "otter.browser.control",
      ({ params }) => {
        if (params?.take === true) control.take(targetOf(params));
        else control.release(targetOf(params));
        return { controlled: params?.take === true };
      },
      { scope: "operator.admin" },
    );
    api.registerGatewayMethod(
      "otter.browser.input",
      async ({ params }) => {
        const profile = typeof params?.profile === "string" ? params.profile : undefined;
        await control.input(targetOf(params), profile, params?.seq, params?.events);
        return {};
      },
      { scope: "operator.admin" },
    );
    api.on("before_tool_call", (event) =>
      /(^|__)browser$/.test(event.toolName) && control.anyHeld()
        ? {
            block: true,
            blockReason:
              "The user has taken control of the browser. Wait until they hand it back, then try again.",
          }
        : undefined,
    );
  },
});
