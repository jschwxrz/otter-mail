// What the plugin does, apart from OpenClaw's SDK, so Otter's tests can run it.

/** Where an agent's deliveries to Otter are kept: one session per agent, read by Otter's apps. */
export const inboxKey = (agentId) => `agent:${agentId}:otter:inbox`;

export const OTTER_TARGET = "inbox";

/** Who sends what you type in Otter: the gateway's owner once `commands.ownerAllowFrom` lists `otter:owner`. */
export const OWNER = "owner";
export const OWNER_ENTRY = `otter:${OWNER}`;

/** A chat in Otter is a target of its own: what's sent to it is kept in its session. */
export const chatTarget = (sessionKey) => `chat:${sessionKey}`;

/** Like posting to a Slack channel rather than in a thread: each delivery starts a chat of its own. */
export const NEW_CHAT_TARGET = "new";

export const isNewChat = (to) =>
  typeof to === "string" && to.trim().replace(/^otter:/, "") === NEW_CHAT_TARGET;

/** A target as the channel keeps it: one of Otter's chats, a new one each time, or the inbox. */
export function targetOf(to) {
  const chat = chatOf(to);
  if (chat) return chatTarget(chat);
  return isNewChat(to) ? NEW_CHAT_TARGET : OTTER_TARGET;
}

/** A session for a new chat, an Otter chat like one you start. */
export const newChatKey = (agentId, id) => `agent:${agentId}:otter-mail:${id}`;

/**
 * What an agent in an Otter chat is told about sending to Otter (the message tool, an automation's
 * delivery), with this chat's own target.
 */
export function otterTargetsNote(sessionKey) {
  const here = agentOf(sessionKey) ? chatTarget(sessionKey) : "chat:<session key>";
  return [
    "Otter delivery targets (channel `otter`), like a thread or a new post in Slack:",
    `- "${here}": this chat. Any Otter chat is "chat:<its session key>".`,
    '- "new": a new Otter chat for each delivery (an automation that should post a fresh chat every run, such as a morning brief).',
    '- "inbox": the agent\'s single Otter inbox chat.',
  ].join("\n");
}

export const agentOf = (sessionKey) =>
  typeof sessionKey === "string" && sessionKey.startsWith("agent:")
    ? sessionKey.split(":")[1]
    : undefined;

/** The chat a target names, if it names one. */
export function chatOf(to) {
  const target = typeof to === "string" ? to.trim().replace(/^otter:/, "") : "";
  if (!target.startsWith("chat:")) return undefined;
  const sessionKey = target.slice("chat:".length);
  return agentOf(sessionKey) ? sessionKey : undefined;
}

/** The session a delivery to this target is kept in. */
export const sessionOf = (to, agentId) => chatOf(to) ?? inboxKey(agentId);

export const isOwnerConfigured = (cfg) =>
  Array.isArray(cfg?.commands?.ownerAllowFrom) &&
  cfg.commands.ownerAllowFrom.some((entry) => String(entry).trim() === OWNER_ENTRY);

/**
 * What the relay is told of a delivery: never its text, only where to read it.
 * Otter's apps read it from the gateway themselves.
 */
export function pointerOf({ sessionKey, to, payload, at = Date.now() }) {
  const data = payload?.channelData ?? {};
  const approval = data.execApproval;
  const question = data.askUser;
  const session = approval?.sessionKey ?? sessionKey;
  // A new chat's session is the one its delivery was routed to.
  const chat = chatOf(to) ?? (isNewChat(to) && agentOf(sessionKey) ? sessionKey : undefined);
  const agentId = approval?.agentId ?? agentOf(chat ?? session) ?? "main";
  return {
    kind: approval ? "approval" : question ? "question" : "message",
    agentId,
    sessionKey: approval || question ? (session ?? null) : (chat ?? inboxKey(agentId)),
    ...(approval && {
      approvalId: String(approval.approvalId),
      approvalKind: approval.approvalKind === "plugin" ? "plugin" : "exec",
      resolved: approval.state === "resolved",
    }),
    ...(question && { questionId: String(question.questionId) }),
    at,
  };
}

export function accountOf(cfg) {
  const section = cfg?.channels?.otter ?? {};
  return {
    accountId: "default",
    enabled: section.enabled !== false,
    relayUrl: typeof section.relayUrl === "string" ? section.relayUrl.replace(/\/+$/, "") : "",
    token: typeof section.token === "string" ? section.token : "",
  };
}

/** Tells Otter's devices; the delivery itself is already kept on the gateway. */
export async function tell(account, pointer, { fetch = globalThis.fetch, signal } = {}) {
  if (!account.relayUrl || !account.token) return false;
  const response = await fetch(`${account.relayUrl}/channel/v1/pointers`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
    body: JSON.stringify(pointer),
  });
  if (!response.ok) throw new Error(`Otter's relay answered ${response.status}`);
  return true;
}

/** A message sent from Otter, checked: where it goes and what it carries. */
export function messageOf(params) {
  const { sessionKey, message, idempotencyKey, attachments } = params ?? {};
  if (typeof sessionKey !== "string" || !agentOf(sessionKey))
    throw new Error("sessionKey must be an agent's session");
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
    throw new Error("idempotencyKey is required");
  const files = Array.isArray(attachments) ? attachments : [];
  for (const file of files)
    if (typeof file?.content !== "string" || typeof file?.mimeType !== "string")
      throw new Error("each attachment needs its content (base64) and mimeType");
  const text = typeof message === "string" ? message : "";
  if (!text.trim() && files.length === 0) throw new Error("message or attachments are required");
  return { sessionKey, agentId: agentOf(sessionKey), text, messageId: idempotencyKey, files };
}
