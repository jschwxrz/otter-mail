import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  createChannelPluginBase,
  createChatChannelPlugin,
  defineChannelPluginEntry,
} from "openclaw/plugin-sdk/channel-core";
import { toInboundMediaFacts } from "openclaw/plugin-sdk/channel-inbound";
import { defineStableChannelIngressIdentity } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/agent-runtime";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import { createBrowserControl } from "./control.js";
import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
import { readWorkspaceFile } from "./files.js";
import {
  accountOf,
  chatOf,
  chatTarget,
  isOwnerConfigured,
  messageOf,
  OTTER_TARGET,
  OWNER,
  pointerOf,
  sessionOf,
  tell,
} from "./otter.js";

/**
 * Where a message sent from Otter starts its run: outside the request that carried it,
 * so the run is the channel's owner's and not that connection's, and outlives it.
 */
const receiving = new AsyncResource("otter-inbound");

const owner = defineStableChannelIngressIdentity({
  key: "otter-sender",
  normalize: (value) => String(value).trim(),
  sensitivity: "pii",
});

async function deliver(ctx, payload) {
  const account = accountOf(ctx.cfg);
  const pointer = pointerOf({ sessionKey: ctx.sessionKey, to: ctx.to, payload });
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
      targetResolver: {
        looksLikeId: () => true,
        hint: `"${OTTER_TARGET}", or "chat:<session key>" for one of Otter's chats`,
      },
      // A delivery to a chat is kept in its session; any other, in the agent's Otter session.
      resolveOutboundSessionRoute: ({ agentId, target }) => {
        const chat = chatOf(target);
        const sessionKey = sessionOf(target, agentId);
        const to = chat ? chatTarget(chat) : OTTER_TARGET;
        return {
          sessionKey,
          baseSessionKey: sessionKey,
          recipientSessionExact: true,
          peer: { kind: "direct", id: to },
          chatType: "direct",
          from: "otter",
          to,
        };
      },
    },
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget: (params) => {
      const chat = chatOf(params?.to);
      return { ok: true, to: chat ? chatTarget(chat) : OTTER_TARGET };
    },
    sendText: (ctx) => deliver(ctx),
    sendPayload: (ctx) => deliver(ctx, ctx.payload),
  },
});

/** Runs what you sent from Otter as the channel's owner: an inbound message, as from any chat app. */
async function receive(api, cfg, message) {
  const { sessionKey, agentId, text, messageId, files } = message;
  const inbound = api.runtime.channel.inbound;
  const saved = await Promise.all(
    files.map((file) =>
      api.runtime.channel.media.saveMediaBuffer(
        Buffer.from(file.content, "base64"),
        file.mimeType,
        "inbound",
        undefined,
        typeof file.fileName === "string" ? file.fileName : undefined,
      ),
    ),
  );
  const channelIngress = await inbound.ingress.resolve({
    channelId: "otter",
    accountId: "default",
    identity: owner,
    subject: { stableId: OWNER },
    conversation: { kind: "direct", id: sessionKey },
    contextBinding: { agentId, sessionKey, messageId, inboundEventKind: "user_request" },
    event: { kind: "message", authMode: "inbound", mayPair: false },
    policy: { dmPolicy: "allowlist" },
    allowFrom: [OWNER],
    readStoreAllowFrom: async () => [],
  });
  const to = chatTarget(sessionKey);
  const ctxPayload = await inbound.buildContext({
    channelIngress,
    channel: "otter",
    accountId: "default",
    messageId,
    timestamp: Date.now(),
    from: `otter:${OWNER}`,
    sender: { id: OWNER, name: "Otter" },
    conversation: { kind: "direct", id: sessionKey },
    route: { agentId, accountId: "default", routeSessionKey: sessionKey },
    reply: { to, originatingTo: to },
    message: { body: text, rawBody: text, commandBody: text, bodyForAgent: text },
    ...(saved.length > 0 && {
      media: toInboundMediaFacts(
        saved.map((file) => ({ path: file.path, contentType: file.contentType, messageId })),
      ),
    }),
  });
  await inbound.dispatch({
    cfg,
    channel: "otter",
    accountId: "default",
    route: { agentId, sessionKey },
    ctxPayload,
    replyOptions: { runId: messageId, sourceReplyDeliveryMode: "automatic" },
    // The reply is kept in the chat's session, which Otter is reading as it's written.
    delivery: { deliver: async () => ({ visibleReplySent: true }) },
  });
}

export default defineChannelPluginEntry({
  id: "otter",
  name: "Otter",
  description: "Send what your agents want you to see to Otter.",
  plugin: otterChannel,
  registerFull(api) {
    // What you send in an Otter chat, as the gateway's owner: `chat.send`'s run, with the authority
    // a configured channel owner has (an automation another chat made, for one).
    api.registerGatewayMethod(
      "otter.chat.send",
      async ({ params, context }) => {
        const cfg = context?.getRuntimeConfig?.() ?? api.config;
        if (!isOwnerConfigured(cfg)) throw new Error("otter_not_owner");
        const message = messageOf(params);
        receiving.runInAsyncScope(() =>
          runDetachedWebhookWork(() => receive(api, cfg, message)).catch((error) =>
            api.logger?.warn?.(`otter: a message from Otter failed: ${String(error)}`),
          ),
        );
        return { runId: message.messageId, status: "started" };
      },
      { scope: "operator.admin" },
    );

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
