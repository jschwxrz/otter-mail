import { describe, expect, it } from "vite-plus/test";
import {
  READ_ONLY,
  cronError,
  listTasks,
  removeTask,
  runRows,
  saveTask,
  taskOf,
  taskRuns,
  type CronGateway,
} from "./schedules.js";

// Shaped like a 2026.11 gateway's answers.
const brief = {
  id: "brief",
  name: "Morning brief",
  description: "Weekday inbox summary",
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 1,
  configRevision: "sha256:rev",
  schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Summarise my inbox", toolsAllow: ["*"] },
  delivery: { mode: "announce", channel: "otter", to: "chat:new" },
  state: { nextRunAtMs: 2000 },
};
const heartbeat = {
  id: "hb",
  name: "heartbeat-dev",
  displayName: "Heartbeat (dev)",
  declarationKey: "heartbeat:dev",
  agentId: "dev",
  enabled: true,
  schedule: { kind: "every", everyMs: 1_800_000, anchorMs: 5 },
  sessionTarget: "main",
  payload: { kind: "heartbeat" },
  delivery: null,
  state: { nextRunAtMs: 3000 },
};
const dreaming = {
  id: "dream",
  name: "Memory Dreaming Promotion",
  declarationKey: "memory-core:memory-dreaming-promotion",
  description: "[managed-by=memory-core.short-term-promotion] Promote recalls into MEMORY.md.",
  enabled: true,
  schedule: { kind: "cron", expr: "0 3 * * *" },
  payload: { kind: "agentTurn", message: "__openclaw_memory_core_short_term_promotion_dream__" },
  delivery: { mode: "none" },
  state: {},
};

function fakeGateway(
  answer: (method: string, params: Record<string, unknown>) => unknown,
  scopes = ["operator.read", "operator.admin"],
) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const g: CronGateway = {
    scopes,
    otterChannel: true,
    async request<T>(method: string, params: unknown) {
      const p = params as Record<string, unknown>;
      calls.push({ method, params: p });
      const result = answer(method, p);
      if (result instanceof Error) throw result;
      return result as T;
    },
  };
  return { g, calls };
}

describe("taskOf", () => {
  it("reads a job the way the app shows it", () => {
    expect(taskOf(brief as never, "main")).toEqual({
      provider: "openclaw",
      id: "brief",
      agent: "main",
      name: "Morning brief",
      description: "Weekday inbox summary",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      enabled: true,
      running: false,
      nextRunAt: 2000,
      delivery: { kind: "otter", chat: "new" },
      revision: "sha256:rev",
    });
  });

  it("marks OpenClaw's own jobs, and hides their internal messages", () => {
    const hb = taskOf(heartbeat as never, "main");
    expect(hb).toMatchObject({
      name: "Heartbeat (dev)",
      agent: "dev",
      managedBy: "OpenClaw's heartbeat",
      delivery: { kind: "none" },
      schedule: { kind: "every", everyMs: 1_800_000 },
    });
    expect(hb.prompt).toBeUndefined();
    const dream = taskOf(dreaming as never, "main");
    expect(dream.managedBy).toBe("OpenClaw (memory-core)");
    expect(dream.prompt).toBeUndefined();
    expect(dream.description).toBe("Promote recalls into MEMORY.md.");
  });

  it("says where a result goes", () => {
    const at = (delivery: unknown, preview?: { detail: string }) =>
      taskOf({ ...brief, delivery } as never, "main", preview).delivery;
    expect(at({ mode: "announce", channel: "otter", to: "chat:agent:main:abc" })).toEqual({
      kind: "otter",
      chat: "one",
    });
    expect(at({ mode: "announce", channel: "telegram", to: "123" })).toEqual({
      kind: "elsewhere",
      label: "Telegram",
    });
    expect(at({ mode: "announce" })).toEqual({
      kind: "elsewhere",
      label: "the last channel used",
    });
    expect(
      at(
        { mode: "announce" },
        { detail: "last -> no route, will be blocked: Channel is required" },
      ),
    ).toEqual({ kind: "none" });
    expect(at({ mode: "webhook", to: "https://x" })).toEqual({
      kind: "elsewhere",
      label: "a webhook",
    });
    expect(at({ mode: "none" })).toEqual({ kind: "none" });
  });

  it("reports a running job, its last failure, and a pause OpenClaw made", () => {
    const task = taskOf(
      {
        ...brief,
        enabled: false,
        state: {
          nextRunAtMs: 9,
          runningAtMs: 5,
          lastRunAtMs: 4,
          lastRunStatus: "error",
          lastError: "raw | invalid_api_key",
          lastDiagnosticSummary: "Couldn't sign in to the AI service.",
          lastDurationMs: 2144,
          autoDisabled: { reason: "consecutive-failures", atMs: 4, consecutiveErrors: 3 },
        },
      } as never,
      "main",
    );
    expect(task.running).toBe(true);
    expect(task.nextRunAt).toBeUndefined();
    expect(task.lastRun).toEqual({
      at: 4,
      status: "error",
      error: "Couldn't sign in to the AI service.",
      durationMs: 2144,
    });
    expect(task.autoPaused).toBe("Paused by OpenClaw after 3 failed runs in a row");
  });

  it("describes schedules Otter can't edit", () => {
    expect(
      taskOf({ ...brief, schedule: { kind: "on-exit", command: "make" } } as never, "main")
        .schedule,
    ).toEqual({ kind: "other", text: "When make exits" });
  });
});

describe("listTasks", () => {
  it("asks for paused jobs too, and pages through them", async () => {
    const { g, calls } = fakeGateway((_method, params) =>
      params.offset === 0
        ? { jobs: [brief], hasMore: true, nextOffset: 1 }
        : {
            jobs: [heartbeat],
            hasMore: false,
            nextOffset: null,
            deliveryPreviews: { hb: { detail: "not requested" } },
          },
    );
    const listed = await listTasks(g, "main");
    expect(calls.map((c) => c.params)).toEqual([
      expect.objectContaining({ includeDisabled: true, offset: 0 }),
      expect.objectContaining({ includeDisabled: true, offset: 1 }),
    ]);
    expect(listed.tasks.map((t) => t.id)).toEqual(["brief", "hb"]);
    expect(listed.readOnly).toBeUndefined();
    expect(listed.can).toEqual({
      create: true,
      deliverToOtter: true,
      history: true,
      timeZones: true,
    });
  });

  it("is read-only without operator.admin", async () => {
    const { g } = fakeGateway(() => ({ jobs: [] }), ["operator.read"]);
    const listed = await listTasks(g, "main");
    expect(listed.readOnly).toBe(READ_ONLY);
    expect(listed.can.create).toBe(false);
  });
});

describe("saveTask", () => {
  it("adds an isolated agent turn, delivered to a new Otter chat", async () => {
    const { g, calls } = fakeGateway(() => ({ id: "new" }));
    await saveTask(g, null, {
      name: "Brief",
      prompt: "Summarise",
      agent: "rowan",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "Europe/London" },
      deliverToOtter: true,
    });
    expect(calls).toEqual([
      {
        method: "cron.add",
        params: {
          name: "Brief",
          agentId: "rowan",
          sessionTarget: "isolated",
          wakeMode: "now",
          schedule: { kind: "cron", expr: "0 8 * * *", tz: "Europe/London" },
          payload: { kind: "agentTurn", message: "Summarise" },
          delivery: { mode: "announce", channel: "otter", to: "chat:new" },
        },
      },
    ]);
  });

  it("keeps a one-off's result nowhere but the gateway unless asked, and removes it after it runs", async () => {
    const { g, calls } = fakeGateway(() => ({}));
    await saveTask(g, null, {
      name: "Once",
      prompt: "Do it",
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
    });
    expect(calls[0].params).toMatchObject({
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
      deleteAfterRun: true,
      delivery: { mode: "none" },
    });
  });

  it("patches only what changed, against the version it read", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      prompt: "Summarise my inbox and calendar",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      deliverToOtter: false,
    });
    expect(calls[1]).toEqual({
      method: "cron.update",
      params: {
        id: "brief",
        patch: {
          payload: {
            kind: "agentTurn",
            message: "Summarise my inbox and calendar",
            toolsAllow: ["*"],
          },
          delivery: {
            mode: "none",
            channel: null,
            to: null,
            threadId: null,
            accountId: null,
            failureDestination: null,
            completionDestination: null,
          },
        },
        expectedConfigRevision: "sha256:rev",
      },
    });
  });

  it("won't overwrite a change made on the gateway since the editor opened", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await expect(
      saveTask(g, "brief", {
        name: "Renamed",
        schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
        revision: "sha256:older",
      }),
    ).rejects.toThrow(/changed on the gateway/);
    await saveTask(g, "brief", {
      name: "Renamed",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      revision: "sha256:rev",
    });
    expect(calls.at(-1)?.params).toMatchObject({
      patch: { name: "Renamed" },
      expectedConfigRevision: "sha256:rev",
    });
  });

  it("keeps a one-off removing itself after it runs, and a repeating task staying", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
    });
    expect(calls[1].params.patch).toMatchObject({ deleteAfterRun: true });
    const once = { ...brief, schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" } };
    const later = fakeGateway((method) => (method === "cron.get" ? once : {}));
    await saveTask(later.g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });
    expect(later.calls[1].params.patch).toMatchObject({ deleteAfterRun: false });
  });

  it("keeps a cron job's stagger when its time changes", async () => {
    const staggered = { ...brief, schedule: { ...brief.schedule, staggerMs: 30_000 } };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? staggered : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Paris" },
    });
    expect(calls[1].params.patch).toEqual({
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Paris", staggerMs: 30_000 },
    });
  });

  it("drops where results went before when they move to Otter", async () => {
    const telegram = {
      ...brief,
      delivery: {
        mode: "announce",
        channel: "telegram",
        to: "123",
        threadId: 7,
        failureDestination: { channel: "telegram", to: "123" },
      },
    };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? telegram : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      deliverToOtter: true,
    });
    expect(calls[1].params.patch).toEqual({
      delivery: {
        mode: "announce",
        channel: "otter",
        to: "chat:new",
        threadId: null,
        accountId: null,
        failureDestination: null,
        completionDestination: null,
      },
    });
  });

  it("says the id of what it saved", async () => {
    const { g } = fakeGateway((method) => (method === "cron.add" ? { id: "made" } : brief));
    expect(
      await saveTask(g, null, {
        name: "x",
        prompt: "y",
        schedule: { kind: "every", everyMs: 60_000 },
      }),
    ).toBe("made");
    expect(
      await saveTask(g, "brief", {
        name: "Morning brief",
        schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      }),
    ).toBe("brief");
  });

  it("sends nothing when nothing changed", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      deliverToOtter: true,
    });
    expect(calls.map((c) => c.method)).toEqual(["cron.get"]);
  });

  it("changes the schedule when only its time zone changed", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "America/New_York" },
    });
    expect(calls[1].params.patch).toEqual({
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "America/New_York" },
    });
  });

  it("won't change or delete OpenClaw's own jobs", async () => {
    const { g, calls } = fakeGateway(() => heartbeat);
    await expect(
      saveTask(g, "hb", { name: "x", schedule: { kind: "every", everyMs: 60_000 } }),
    ).rejects.toThrow(/paused or run/);
    await expect(removeTask(g, "hb")).rejects.toThrow(/pause it instead/);
    expect(calls.every((c) => c.method === "cron.get")).toBe(true);
  });
});

describe("runs", () => {
  it("lists a job's runs, newest first, with why one failed", async () => {
    const { g, calls } = fakeGateway(() => ({
      entries: [
        {
          ts: 10,
          jobId: "brief",
          action: "finished",
          status: "error",
          error: "raw | invalid_api_key",
          diagnostics: { summary: "Couldn't sign in to the AI service." },
          runId: "cron-request.1",
          runAtMs: 8,
          durationMs: 2144,
          model: "gpt-6-astra",
          deliveryStatus: "not-delivered",
        },
        {
          ts: 5,
          jobId: "brief",
          action: "finished",
          status: "ok",
          summary: "All quiet",
          deliveryStatus: "unknown",
        },
      ],
    }));
    expect(await taskRuns(g, "brief", 20)).toEqual([
      {
        id: "cron-request.1",
        at: 8,
        status: "error",
        durationMs: 2144,
        error: "Couldn't sign in to the AI service.",
        model: "gpt-6-astra",
        delivered: false,
      },
      { id: "at:5", at: 5, status: "ok", summary: "All quiet" },
    ]);
    expect(calls[0].params).toEqual({ id: "brief", limit: 20, sortDir: "desc" });
  });

  it("shows a run's job message as what was asked, without the scheduler's preamble", async () => {
    const { g, calls } = fakeGateway(() => ({
      messages: [
        {
          role: "assistant",
          content:
            "Summarise my inbox\nCurrent time: Sunday\n\nThis is an unattended scheduled run.",
          provenance: { kind: "internal_system", sourceTool: "cron" },
        },
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
      ],
    }));
    const rows = await runRows(g, "brief", "at:5");
    expect(calls[0].params).toEqual({ id: "brief", runAtMs: 5, limit: 200 });
    expect(rows[0]).toMatchObject({ role: "user", content: "Summarise my inbox" });
    expect(rows[1].role).toBe("assistant");
  });

  it("reads a long run's every page", async () => {
    const { g, calls } = fakeGateway((_method, params) =>
      params.cursor
        ? { messages: [{ role: "assistant", content: "two" }] }
        : { messages: [{ role: "assistant", content: "one" }], nextCursor: "c2" },
    );
    const rows = await runRows(g, "brief", "cron-request.1");
    expect(rows.map((r) => r.content)).toEqual(["one", "two"]);
    expect(calls[1].params).toMatchObject({ runId: "cron-request.1", cursor: "c2" });
  });
});

describe("cronError", () => {
  const gatewayError = (message: string, code?: string) =>
    Object.assign(new Error(message), code ? { details: { code } } : {});

  it("says each refusal for people", () => {
    expect(cronError(gatewayError("missing scope: operator.admin")).message).toBe(READ_ONLY);
    expect(cronError(gatewayError("Automation not found: x.", "CRON_JOB_NOT_FOUND")).message).toBe(
      "That task is gone from the gateway.",
    );
    expect(cronError(gatewayError("no longer matches", "CRON_JOB_CHANGED")).message).toMatch(
      /changed on the gateway/,
    );
    expect(
      cronError(
        gatewayError("invalid cron.add params: delivery.channel is not a known channel: otter"),
      ).message,
    ).toMatch(/Messages from your agents/);
    expect(cronError(gatewayError("invalid cron.add params: bad expr")).message).toBe("bad expr");
  });
});
