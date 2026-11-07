import { randomUUID } from "node:crypto";
import {
  createChannelPluginBase,
  createChatChannelPlugin,
  defineChannelPluginEntry,
} from "openclaw/plugin-sdk/channel-core";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/agent-runtime";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
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
  },
});
