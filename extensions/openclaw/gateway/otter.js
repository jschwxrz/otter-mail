// What the plugin does, apart from OpenClaw's SDK, so Otter's tests can run it.

/** Where an agent's deliveries to Otter are kept: one session per agent, read by Otter's apps. */
export const inboxKey = (agentId) => `agent:${agentId}:otter:inbox`;

export const OTTER_TARGET = "inbox";

export const agentOf = (sessionKey) =>
  typeof sessionKey === "string" && sessionKey.startsWith("agent:")
    ? sessionKey.split(":")[1]
    : undefined;

/**
 * What the relay is told of a delivery: never its text, only where to read it.
 * Otter's apps read it from the gateway themselves.
 */
export function pointerOf({ sessionKey, payload, at = Date.now() }) {
  const data = payload?.channelData ?? {};
  const approval = data.execApproval;
  const question = data.askUser;
  const session = approval?.sessionKey ?? sessionKey;
  const agentId = approval?.agentId ?? agentOf(session) ?? "main";
  return {
    kind: approval ? "approval" : question ? "question" : "message",
    agentId,
    sessionKey: approval || question ? (session ?? null) : inboxKey(agentId),
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
