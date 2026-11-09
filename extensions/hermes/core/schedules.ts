/**
 * Hermes's cron jobs (/api/jobs) as scheduled tasks. Each run is a session of its own (source
 * "cron"), so its past runs and their transcripts are its cron sessions. A job that keeps its
 * results on Hermes (deliver "local") has them come to Otter: each run a new chat, unless Otter
 * was told to leave them there (`mutedJobs`, Otter's own setting: Hermes has no "nowhere").
 */

import {
  agentSettings,
  logger,
  preferenceChanged,
  saveAgentSettings,
} from "@otter/core/extension-kit";
import type {
  AgentRun,
  ChatSessionMessage,
  ScheduleSupport,
  WatchedSession,
} from "@otter/core/extension-kit";
import type { ScheduledTask, ScheduledTaskInput, TaskRun } from "@otter/contracts/scheduled";

import {
  authHeaders,
  readError,
  requireReady,
  sessionMessages,
  toMillis,
  type RawSession,
  type Ready,
} from "./http.js";
import type { HermesSettings } from "./settings.js";

export type HermesJob = {
  id: string;
  name?: string;
  prompt?: string;
  schedule?: { kind?: string; expr?: string; minutes?: number; run_at?: string; display?: string };
  schedule_display?: string;
  timezone?: string;
  enabled?: boolean;
  state?: string;
  paused_reason?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  deliver?: string;
  no_agent?: boolean;
  script?: string | null;
};

const time = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? undefined : at;
};

const muted = (settings: Pick<HermesSettings, "mutedJobs">) =>
  new Set((settings.mutedJobs ?? "").split(",").filter(Boolean));

/** Its results stay on Hermes, where Otter reads them. */
const keepsResults = (job: HermesJob) => (job.deliver ?? "local") === "local";

const toOtter = (job: HermesJob, settings: Pick<HermesSettings, "mutedJobs">) =>
  keepsResults(job) && !muted(settings).has(job.id);

/** A Hermes cron job (GET /api/jobs) as a scheduled task. */
export function hermesTask(
  job: HermesJob,
  settings: Pick<HermesSettings, "mutedJobs"> = {},
): ScheduledTask {
  const s = job.schedule ?? {};
  const schedule: ScheduledTask["schedule"] =
    s.kind === "cron" && s.expr
      ? { kind: "cron", expr: s.expr, ...(job.timezone ? { tz: job.timezone } : {}) }
      : s.kind === "interval" && s.minutes
        ? { kind: "every", everyMs: s.minutes * 60_000 }
        : s.kind === "once" && s.run_at
          ? { kind: "at", at: s.run_at }
          : { kind: "other", text: job.schedule_display ?? s.display ?? "On its own schedule" };
  const enabled = job.enabled !== false && job.state !== "paused";
  const nextRunAt = enabled ? time(job.next_run_at) : undefined;
  const lastAt = time(job.last_run_at);
  const failed = job.last_status === "error" || job.last_status === "failed";
  const deliver = job.deliver ?? "local";
  return {
    provider: "hermes",
    id: job.id,
    name: job.name || job.id,
    ...(job.prompt && !job.no_agent ? { prompt: job.prompt } : {}),
    schedule,
    enabled,
    running: job.state === "running",
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(lastAt && job.last_status
      ? {
          lastRun: {
            at: lastAt,
            status: failed ? "error" : "ok",
            ...(failed && job.last_error ? { error: job.last_error } : {}),
          },
        }
      : {}),
    delivery:
      deliver === "local"
        ? toOtter(job, settings)
          ? { kind: "otter", chat: "new" }
          : { kind: "none" }
        : {
            kind: "elsewhere",
            label:
              deliver === "origin"
                ? "where it was set up"
                : deliver.charAt(0).toUpperCase() + deliver.slice(1),
          },
  };
}

/** A schedule in words Hermes parses (`hermes cron`'s): a cron expression, `every 90m`, an ISO time. */
export function hermesSchedule(schedule: ScheduledTaskInput["schedule"]): string {
  if (schedule.kind === "cron") return schedule.expr;
  if (schedule.kind === "every")
    return `every ${Math.max(1, Math.round(schedule.everyMs / 60_000))}m`;
  return schedule.at;
}

const JOBS_TIMEOUT_MS = 10_000;

async function jobsRequest<T>(
  settings: HermesSettings,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const ready = await requireReady(settings).catch(() => {
    throw new Error("Connect Hermes in Settings → Hermes.");
  });
  const response = await fetch(`${ready.root}/api/jobs${path}`, {
    signal: AbortSignal.timeout(JOBS_TIMEOUT_MS),
    method: init.method ?? "GET",
    headers: authHeaders(ready.key, init.body !== undefined),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string | { message?: string };
    } | null;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    if (response.status === 404 && path.startsWith("/"))
      throw new Error("That task is gone from Hermes.");
    if (response.status === 404 || response.status === 501)
      throw new Error("This Hermes doesn't run scheduled tasks. Update it to manage them here.");
    throw new Error(message ?? `Hermes answered ${response.status}.`);
  }
  return (await response.json().catch(() => ({}))) as T;
}

const jobPath = (id: string) => `/${encodeURIComponent(id)}`;

async function setMuted(settings: HermesSettings, id: string, on: boolean): Promise<void> {
  const ids = muted(settings);
  if (ids.has(id) === on) return;
  if (on) ids.add(id);
  else ids.delete(id);
  settings.mutedJobs = [...ids].join(",");
  await saveAgentSettings("hermes", { mutedJobs: settings.mutedJobs });
  preferenceChanged("assistant");
}

/** Where results go, as Hermes takes it; undefined leaves it. */
function deliverFor(input: ScheduledTaskInput): string | undefined {
  const to = input.resultsTo;
  if (!to) return undefined;
  if (to.kind === "new-chat" || to.kind === "off") return "local";
  throw new Error("Hermes sends results to Otter, or keeps them.");
}

async function cronSessions(ready: Ready, limit = 100): Promise<RawSession[]> {
  const response = await fetch(`${ready.root}/api/sessions?source=cron&limit=${limit}`, {
    headers: authHeaders(ready.key),
    signal: AbortSignal.timeout(JOBS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { data?: RawSession[] }).data ?? [];
}

/** The job a cron session is a run of: by its id (`cron_<job>_<time>`), else its title (`<name> · <time>`). */
export function jobOf(session: RawSession, jobs: HermesJob[]): HermesJob | undefined {
  const id = String(session.id ?? "");
  const byId = jobs.find((j) => id.startsWith(`cron_${j.id}_`));
  if (byId) return byId;
  const title = String(session.title ?? "");
  return jobs.find((j) => {
    const name = (j.name ?? "").split(/\s+/).join(" ").slice(0, 60).trim();
    return name && title.startsWith(`${name} · `);
  });
}

const SILENT = "[SILENT]";

/** What the run wrote you: its replies, without the prompt Hermes sent it. */
export function runReply(messages: ChatSessionMessage[]): ChatSessionMessage[] {
  return messages.filter((m) => m.role !== "user" && m.role !== "system");
}

/** Its final reply, which is what Hermes delivers. */
const finalReply = (reply: ChatSessionMessage[]) =>
  reply.findLast((m) => m.role === "assistant" && m.text.trim())?.text.trim() ?? "";

function taskRun(session: RawSession): TaskRun {
  const at = toMillis(session.started_at);
  const ended = toMillis(session.ended_at);
  const failed = session.end_reason === "cron_incomplete_no_output";
  return {
    id: String(session.id),
    at,
    status: failed ? "error" : "ok",
    ...(ended > at ? { durationMs: ended - at } : {}),
    ...(failed ? { error: "It finished without a result." } : {}),
    ...(session.model ? { model: session.model } : {}),
  };
}

export const CRON_RUN = "cron:";

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** How long a run counts as new to a device that hasn't seen it: the day's deliveries. */
const BACKLOG_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 60_000;

type Watching = {
  sessions: Set<string>;
  started: (run: AgentRun) => void;
};
let watching: Watching | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
let checking: Promise<void> | null = null;
let checkedAt = 0;
/** A chat list that changes often (each message) needn't ask Hermes each time. */
const RECHECK_MS = 15_000;
/** Runs already shown, or with nothing to show. */
const seen = new Set<string>();

/** Runs that finished since: each starts a chat of its own (`AgentRun.chat`), like OpenClaw's `chat:new`. */
async function checkDeliveries(): Promise<void> {
  if (!watching) return;
  // As they are now: a task turned off, here or on another device, stays off.
  const settings = (await agentSettings("hermes")) as HermesSettings;
  const ready = await requireReady(settings).catch(() => null);
  if (!ready) return;
  const [sessions, { jobs }] = await Promise.all([
    cronSessions(ready),
    jobsRequest<{ jobs: HermesJob[] }>(settings, "?include_disabled=true"),
  ]);
  const since = Date.now() - BACKLOG_MS;
  for (const session of sessions) {
    const id = String(session.id ?? "");
    const ended = toMillis(session.ended_at);
    if (!id || seen.has(id) || watching?.sessions.has(id) || !ended) continue;
    if (ended < since) {
      seen.add(id);
      continue;
    }
    const job = jobOf(session, jobs);
    if (!job || !toOtter(job, settings)) continue;
    const reply = finalReply(runReply(await sessionMessages(ready, id)));
    // The chats watched change as they're made: the run is shown if none has it yet.
    const w = watching;
    if (!w) return;
    seen.add(id);
    if (!reply || reply.startsWith(SILENT) || w.sessions.has(id)) continue;
    logger.info("agent", "hermes scheduled run", { job: job.id, session: id });
    w.started({
      sessionId: id,
      requestId: `${CRON_RUN}${id}`,
      chat: { title: `${job.name || "Hermes"} · ${shortDate(ended)}` },
      deliveredAt: ended,
      delivery: {
        kind: "automation",
        jobId: job.id,
        ...(job.name ? { name: job.name } : {}),
        ...((job.schedule_display ?? job.schedule?.display)
          ? { schedule: job.schedule_display ?? job.schedule?.display }
          : {}),
      },
    });
  }
}

function checkSoon(): void {
  checkedAt = Date.now();
  checking ??= checkDeliveries()
    .catch((error: unknown) =>
      logger.info("agent", "hermes deliveries unavailable", { error: String(error) }),
    )
    .finally(() => {
      checking = null;
    });
}

export function watchDeliveries(
  sessions: WatchedSession[],
  started: (run: AgentRun) => void,
): void {
  watching = { sessions: new Set(sessions.map((s) => s.id)), started };
  poll ??= setInterval(checkSoon, POLL_MS);
  if (Date.now() - checkedAt > RECHECK_MS) checkSoon();
}

export function stopWatching(): void {
  watching = null;
  checkedAt = 0;
  clearInterval(poll);
  poll = undefined;
}

/** A run that came to Otter, as its chat's turn. */
export async function deliveredReply(ready: Ready, sessionId: string) {
  return runReply(await sessionMessages(ready, sessionId));
}

export const hermesSchedules: ScheduleSupport<HermesSettings> = {
  async list(settings) {
    if (!(await requireReady(settings).catch(() => null))) return null;
    const { jobs } = await jobsRequest<{ jobs: HermesJob[] }>(settings, "?include_disabled=true");
    return {
      tasks: jobs.map((job) => hermesTask(job, settings)),
      channels: [],
      can: {
        create: true,
        deliverToOtter: true,
        webhooks: false,
        history: true,
        timeZones: false,
      },
    };
  },
  async save(settings, id, input) {
    const deliver = deliverFor(input);
    const body = {
      name: input.name,
      schedule: hermesSchedule(input.schedule),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(deliver ? { deliver } : {}),
    };
    let saved = id;
    if (id) {
      // Hermes works out the next run again whenever it's sent a schedule: only a new one.
      const { job } = await jobsRequest<{ job: HermesJob }>(settings, jobPath(id));
      const current = hermesTask(job).schedule;
      const same = current.kind !== "other" && hermesSchedule(current) === body.schedule;
      const { schedule: _schedule, ...rest } = body;
      await jobsRequest(settings, jobPath(id), { method: "PATCH", body: same ? rest : body });
    } else {
      const made = await jobsRequest<{ job?: { id?: string } }>(settings, "", {
        method: "POST",
        body: { ...body, deliver: deliver ?? "local" },
      });
      saved = made.job?.id ?? "";
    }
    if (saved && input.resultsTo) await setMuted(settings, saved, input.resultsTo.kind === "off");
    return saved ?? "";
  },
  async setEnabled(settings, id, enabled) {
    await jobsRequest(settings, `${jobPath(id)}/${enabled ? "resume" : "pause"}`, {
      method: "POST",
    });
  },
  async runNow(settings, id) {
    await jobsRequest(settings, `${jobPath(id)}/run`, { method: "POST" });
  },
  async remove(settings, id) {
    await jobsRequest(settings, jobPath(id), { method: "DELETE" });
    await setMuted(settings, id, false);
  },
  async runs(settings, id, limit) {
    const ready = await requireReady(settings);
    const [sessions, { job }] = await Promise.all([
      cronSessions(ready, 200),
      jobsRequest<{ job: HermesJob }>(settings, jobPath(id)),
    ]);
    return sessions
      .filter((s) => s.ended_at && jobOf(s, [job]))
      .slice(0, limit)
      .map(taskRun);
  },
  async runTranscript(settings, _id, runId) {
    return runReply(await sessionMessages(await requireReady(settings), runId));
  },
};
