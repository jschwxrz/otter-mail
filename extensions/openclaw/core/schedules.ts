import type {
  AgentScheduledTasks,
  ScheduledTask,
  ScheduledTaskInput,
  TaskDelivery,
  TaskRun,
  TaskSchedule,
} from "@otter/contracts/scheduled";

/** The gateway as the scheduler sees it: what it answers, what this device may do, its agents. */
export type CronGateway = {
  request<T>(method: string, params: unknown): Promise<T>;
  scopes: string[];
  /** The Otter plugin is on the gateway, so `otter` is a channel jobs can deliver to. */
  otterChannel: boolean;
};

type Job = {
  id: string;
  name: string;
  displayName?: string | null;
  declarationKey?: string | null;
  description?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  enabled: boolean;
  configRevision?: string;
  schedule: Record<string, unknown> & { kind: string };
  payload: Record<string, unknown> & { kind: string };
  delivery?: (Record<string, unknown> & { mode: string }) | null;
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDiagnosticSummary?: string;
    lastDurationMs?: number;
    autoDisabled?: { reason: string; consecutiveErrors: number };
  };
  nextRunAtMs?: number;
};

type RunEntry = {
  ts: number;
  runId?: string;
  runAtMs?: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  diagnostics?: { summary?: string };
  durationMs?: number;
  model?: string;
  delivered?: boolean;
  deliveryStatus?: string;
};

const ADMIN = "operator.admin";

/** Where a job sends its result in Otter: a new chat each time (`chat:new`) or one chat (`chat:<session key>`). */
const NEW_CHAT = "chat:new";

export const READ_ONLY =
  "Otter can see these but not change them: allow it full access to the gateway in Settings → OpenClaw.";

/** OpenClaw's own jobs (`heartbeat:main`, `memory-core:…`): kept from its config, so not Otter's to edit. */
function managedBy(job: Job): string | undefined {
  const key = job.declarationKey;
  if (!key) return undefined;
  const owner = key.split(":")[0];
  return owner === "heartbeat" ? "OpenClaw's heartbeat" : `OpenClaw (${owner})`;
}

/** What a job asks, when it's a message a person wrote (not a plugin's internal marker). */
function promptOf(job: Job): string | undefined {
  const text =
    job.payload.kind === "agentTurn"
      ? job.payload.message
      : job.payload.kind === "systemEvent"
        ? job.payload.text
        : undefined;
  return typeof text === "string" && !text.startsWith("__openclaw_") ? text : undefined;
}

export function scheduleOf(schedule: Job["schedule"]): TaskSchedule {
  if (schedule.kind === "cron" && typeof schedule.expr === "string")
    return {
      kind: "cron",
      expr: schedule.expr,
      ...(typeof schedule.tz === "string" ? { tz: schedule.tz } : {}),
    };
  if (schedule.kind === "every" && typeof schedule.everyMs === "number")
    return { kind: "every", everyMs: schedule.everyMs };
  if (schedule.kind === "at" && typeof schedule.at === "string")
    return { kind: "at", at: schedule.at };
  if (schedule.kind === "on-exit")
    return { kind: "other", text: `When ${String(schedule.command)} exits` };
  if (schedule.kind === "stream")
    return { kind: "other", text: "When a command it watches prints" };
  return { kind: "other", text: schedule.kind };
}

const channelName = (channel: string) => channel.charAt(0).toUpperCase() + channel.slice(1);

export function deliveryOf(job: Job, preview?: { detail?: string }): TaskDelivery {
  const delivery = job.delivery;
  if (job.payload.kind === "heartbeat" || !delivery || delivery.mode === "none")
    return { kind: "none" };
  if (delivery.mode === "webhook") return { kind: "elsewhere", label: "a webhook" };
  const channel = typeof delivery.channel === "string" ? delivery.channel : "last";
  if (channel === "otter")
    return { kind: "otter", chat: delivery.to === NEW_CHAT || !delivery.to ? "new" : "one" };
  // The gateway says where the result would go now; "blocked" is nowhere.
  if (preview?.detail && /will be blocked/.test(preview.detail)) return { kind: "none" };
  return {
    kind: "elsewhere",
    label: channel === "last" ? "the last channel used" : channelName(channel),
  };
}

function autoPaused(job: Job): string | undefined {
  const auto = job.state?.autoDisabled;
  if (!auto || job.enabled) return undefined;
  return auto.reason === "consecutive-failures"
    ? `Paused by OpenClaw after ${auto.consecutiveErrors} failed runs in a row`
    : "Paused by OpenClaw: its schedule kept failing";
}

export function taskOf(
  job: Job,
  defaultAgent: string,
  preview?: { detail?: string },
): ScheduledTask {
  const state = job.state ?? {};
  const lastStatus = state.lastRunStatus ?? state.lastStatus;
  const agent = job.agentId ?? job.sessionKey?.split(":")[1] ?? defaultAgent;
  const description = job.description?.replace(/^\[managed-by=[^\]]*\]\s*/, "").trim();
  const prompt = promptOf(job);
  const managed = managedBy(job);
  const paused = autoPaused(job);
  const nextRunAt = job.enabled ? (state.nextRunAtMs ?? job.nextRunAtMs) : undefined;
  return {
    provider: "openclaw",
    id: job.id,
    agent,
    name: job.displayName || job.name,
    ...(description ? { description } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    schedule: scheduleOf(job.schedule),
    enabled: job.enabled,
    running: typeof state.runningAtMs === "number",
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(state.lastRunAtMs && lastStatus
      ? {
          lastRun: {
            at: state.lastRunAtMs,
            status: lastStatus,
            ...(lastStatus === "error"
              ? { error: state.lastDiagnosticSummary ?? state.lastError }
              : {}),
            ...(state.lastDurationMs !== undefined ? { durationMs: state.lastDurationMs } : {}),
          },
        }
      : {}),
    delivery: deliveryOf(job, preview),
    ...(managed ? { managedBy: managed } : {}),
    ...(paused ? { autoPaused: paused } : {}),
    ...(job.configRevision ? { revision: job.configRevision } : {}),
  };
}

const CHANGED = "It changed on the gateway while you were editing it. Look again and save.";

/** A gateway's refusal, said for people. */
export function cronError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { details?: { code?: string } } | null)?.details?.code;
  if (/missing scope|operator\.admin/i.test(message)) return new Error(READ_ONLY);
  if (code === "CRON_JOB_NOT_FOUND" || message.startsWith("Automation not found"))
    return new Error("That task is gone from the gateway.");
  if (code === "CRON_JOB_CHANGED") return new Error(CHANGED);
  if (/not a known channel: otter/.test(message))
    return new Error(
      "The gateway can't send to Otter yet: set up Messages from your agents in Settings → OpenClaw.",
    );
  return new Error(message.replace(/^invalid cron\.\w+ params: /, ""));
}

async function call<T>(g: CronGateway, method: string, params: unknown): Promise<T> {
  try {
    return await g.request<T>(method, params);
  } catch (error) {
    throw cronError(error);
  }
}

const PAGE = 200;

export async function listTasks(
  g: CronGateway,
  defaultAgent: string,
): Promise<Omit<AgentScheduledTasks, "provider">> {
  const jobs: Job[] = [];
  const previews: Record<string, { detail?: string }> = {};
  for (let offset = 0; ;) {
    const page = await call<{
      jobs: Job[];
      hasMore?: boolean;
      nextOffset?: number | null;
      deliveryPreviews?: Record<string, { detail?: string }>;
    }>(g, "cron.list", {
      includeDisabled: true,
      sortBy: "nextRunAtMs",
      sortDir: "asc",
      limit: PAGE,
      offset,
      includeDeliveryPreviews: true,
    });
    jobs.push(...page.jobs);
    Object.assign(previews, page.deliveryPreviews);
    if (!page.hasMore || typeof page.nextOffset !== "number" || page.nextOffset <= offset) break;
    offset = page.nextOffset;
  }
  const admin = g.scopes.includes(ADMIN);
  return {
    tasks: jobs.map((job) => taskOf(job, defaultAgent, previews[job.id])),
    ...(admin ? {} : { readOnly: READ_ONLY }),
    can: { create: admin, deliverToOtter: g.otterChannel, history: true, timeZones: true },
  };
}

function cronSchedule(schedule: ScheduledTaskInput["schedule"]): Record<string, unknown> {
  if (schedule.kind === "cron")
    return { kind: "cron", expr: schedule.expr, ...(schedule.tz ? { tz: schedule.tz } : {}) };
  if (schedule.kind === "every") return { kind: "every", everyMs: schedule.everyMs };
  return { kind: "at", at: schedule.at };
}

const sameSchedule = (job: Job["schedule"], wanted: Record<string, unknown>) =>
  Object.keys(wanted).every((key) => job[key] === wanted[key]) &&
  (wanted.kind !== "cron" || (job.tz ?? undefined) === wanted.tz);

const otterDelivery = { mode: "announce", channel: "otter", to: NEW_CHAT };
/** The gateway merges a delivery patch: what routed it elsewhere goes, or failures still alert there. */
const elsewhereCleared = {
  threadId: null,
  accountId: null,
  failureDestination: null,
  completionDestination: null,
};

/** Saves the task; its id. */
export async function saveTask(
  g: CronGateway,
  id: string | null,
  input: ScheduledTaskInput,
): Promise<string> {
  const schedule = cronSchedule(input.schedule);
  if (!id) {
    if (input.prompt === undefined) throw new Error("Say what the agent should do.");
    const added = await call<{ id?: string; job?: { id?: string } }>(g, "cron.add", {
      name: input.name,
      ...(input.agent ? { agentId: input.agent } : {}),
      sessionTarget: "isolated",
      wakeMode: "now",
      schedule,
      ...(input.schedule.kind === "at" ? { deleteAfterRun: true } : {}),
      payload: { kind: "agentTurn", message: input.prompt },
      delivery: input.deliverToOtter ? otterDelivery : { mode: "none" },
    });
    return added.id ?? added.job?.id ?? "";
  }
  const job = await call<Job>(g, "cron.get", { id });
  if (job.declarationKey)
    throw new Error("OpenClaw keeps this one itself: it can be paused or run, not changed.");
  const revision = input.revision ?? job.configRevision;
  if (input.revision && job.configRevision && input.revision !== job.configRevision)
    throw new Error(CHANGED);
  const patch: Record<string, unknown> = {};
  if (input.name !== (job.displayName || job.name)) {
    patch.name = input.name;
    if (job.displayName) patch.displayName = null;
  }
  if (!sameSchedule(job.schedule, schedule)) {
    patch.schedule =
      schedule.kind === "cron" && job.schedule.kind === "cron" && job.schedule.staggerMs
        ? { ...schedule, staggerMs: job.schedule.staggerMs }
        : schedule;
    // A one-off goes once it has run; a repeating task stays.
    if ((schedule.kind === "at") !== (job.schedule.kind === "at"))
      patch.deleteAfterRun = schedule.kind === "at";
  }
  const prompt = promptOf(job);
  if (input.prompt !== undefined && prompt !== undefined && input.prompt !== prompt)
    patch.payload =
      job.payload.kind === "agentTurn"
        ? { ...job.payload, message: input.prompt }
        : { ...job.payload, text: input.prompt };
  if (input.agent && input.agent !== job.agentId && !job.sessionKey) patch.agentId = input.agent;
  const toOtter = job.delivery?.mode === "announce" && job.delivery.channel === "otter";
  if (input.deliverToOtter === true && !toOtter)
    patch.delivery = { ...otterDelivery, ...elsewhereCleared };
  if (input.deliverToOtter === false && toOtter)
    patch.delivery = { mode: "none", channel: null, to: null, ...elsewhereCleared };
  if (Object.keys(patch).length > 0)
    await call(g, "cron.update", {
      id,
      patch,
      ...(revision ? { expectedConfigRevision: revision } : {}),
    });
  return id;
}

export async function setTaskEnabled(g: CronGateway, id: string, enabled: boolean) {
  await call(g, "cron.update", { id, patch: { enabled } });
}

export async function runTask(g: CronGateway, id: string) {
  await call(g, "cron.run", { id, mode: "force" });
}

export async function removeTask(g: CronGateway, id: string) {
  const job = await call<Job>(g, "cron.get", { id });
  if (job.declarationKey)
    throw new Error("OpenClaw keeps this one itself: pause it instead of deleting it.");
  await call(g, "cron.remove", { id });
}

const HISTORY_PAGES = 5;

/** A run's id for Otter: the gateway's run id, or when it ran for runs logged without one. */
const runKey = (entry: RunEntry) => entry.runId ?? `at:${entry.runAtMs ?? entry.ts}`;

export async function taskRuns(g: CronGateway, id: string, limit: number): Promise<TaskRun[]> {
  const { entries } = await call<{ entries: RunEntry[] }>(g, "cron.runs", {
    id,
    limit,
    sortDir: "desc",
  });
  return entries.map((entry) => ({
    id: runKey(entry),
    at: entry.runAtMs ?? entry.ts,
    status: entry.status ?? "ok",
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.status === "error"
      ? { error: entry.diagnostics?.summary ?? entry.error ?? "It failed." }
      : {}),
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.deliveryStatus === "delivered" || entry.deliveryStatus === "not-delivered"
      ? { delivered: entry.deliveryStatus === "delivered" }
      : {}),
  }));
}

/**
 * The rows of one run (`cron.history`). The scheduler writes the job's message, with its own
 * preamble for unattended runs, as the run's first row: that's shown as what was asked.
 */
export async function runRows(
  g: CronGateway,
  id: string,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const at = /^at:(\d+)$/.exec(runId)?.[1];
  const messages: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const result = await call<{ messages: Record<string, unknown>[]; nextCursor?: string }>(
      g,
      "cron.history",
      {
        id,
        ...(at ? { runAtMs: Number(at) } : { runId }),
        limit: 200,
        ...(cursor ? { cursor } : {}),
      },
    );
    messages.push(...result.messages);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return messages.map((row) => {
    const provenance = row.provenance as { kind?: string; sourceTool?: string } | undefined;
    if (provenance?.kind !== "internal_system" || provenance.sourceTool !== "cron") return row;
    const text = typeof row.content === "string" ? row.content : "";
    return { ...row, role: "user", content: text.split(/\nCurrent time: /)[0] };
  });
}
