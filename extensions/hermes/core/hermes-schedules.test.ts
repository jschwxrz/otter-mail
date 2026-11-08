import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { HermesSettings } from "./settings.js";

vi.mock("../../../packages/core/src/services/agent/settings.js", () => ({
  getHermesKey: async () => "test-key",
}));
const { hermesProvider, hermesSchedule, hermesTask } = await import("./hermes.js");
const settings = { baseUrl: "https://hermes.test/v1", enabled: true } as HermesSettings;
const schedules = hermesProvider.schedules!;

afterEach(() => vi.unstubAllGlobals());

// As `hermes cron` stores it (cron/jobs.py's create_job).
const job = {
  id: "a1b2c3",
  name: "Morning brief",
  prompt: "Summarise my inbox",
  schedule: { kind: "cron", expr: "0 9 * * 1-5", display: "0 9 * * 1-5" },
  schedule_display: "0 9 * * 1-5",
  enabled: true,
  state: "scheduled",
  next_run_at: "2026-11-09T09:00:00+00:00",
  last_run_at: "2026-11-06T09:00:00+00:00",
  last_status: "error",
  last_error: "Model unavailable",
  deliver: "local",
};

function serve(answer: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, init });
      return answer(url, init);
    }),
  );
  return calls;
}

describe("hermesTask", () => {
  it("reads a Hermes job", () => {
    expect(hermesTask(job)).toEqual({
      provider: "hermes",
      id: "a1b2c3",
      name: "Morning brief",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: true,
      running: false,
      nextRunAt: Date.parse("2026-11-09T09:00:00Z"),
      lastRun: {
        at: Date.parse("2026-11-06T09:00:00Z"),
        status: "error",
        error: "Model unavailable",
      },
      delivery: { kind: "none" },
    });
  });

  it("reads intervals, one-offs, pauses and deliveries", () => {
    expect(
      hermesTask({ ...job, schedule: { kind: "interval", minutes: 90 }, deliver: "telegram" }),
    ).toMatchObject({
      schedule: { kind: "every", everyMs: 5_400_000 },
      delivery: { kind: "elsewhere", label: "Telegram" },
    });
    expect(
      hermesTask({ ...job, schedule: { kind: "once", run_at: "2026-12-01T10:00:00+00:00" } })
        .schedule,
    ).toEqual({ kind: "at", at: "2026-12-01T10:00:00+00:00" });
    const paused = hermesTask({ ...job, enabled: false, state: "paused" });
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeUndefined();
    expect(hermesTask({ ...job, state: "running" }).running).toBe(true);
  });
});

describe("hermesSchedule", () => {
  it("writes schedules the way Hermes parses them", () => {
    expect(hermesSchedule({ kind: "cron", expr: "0 9 * * *", tz: "Europe/Paris" })).toBe(
      "0 9 * * *",
    );
    expect(hermesSchedule({ kind: "every", everyMs: 7_200_000 })).toBe("every 120m");
    expect(hermesSchedule({ kind: "at", at: "2026-12-01T10:00:00.000Z" })).toBe(
      "2026-12-01T10:00:00.000Z",
    );
  });
});

describe("Hermes's jobs API", () => {
  it("lists paused jobs too", async () => {
    const calls = serve(() => Response.json({ jobs: [job] }));
    const listed = await schedules.list(settings);
    expect(calls[0].url.href).toBe("https://hermes.test/api/jobs?include_disabled=true");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(listed?.tasks).toHaveLength(1);
    expect(listed?.can).toMatchObject({ create: true, deliverToOtter: false, history: false });
  });

  it("isn't listed until Hermes is set up", async () => {
    const calls = serve(() => Response.json({ jobs: [] }));
    expect(await schedules.list({ ...settings, baseUrl: "" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("creates, edits, pauses, resumes, runs and deletes", async () => {
    const calls = serve(() => Response.json({ job }));
    expect(
      await schedules.save(settings, null, {
        name: "Brief",
        prompt: "Go",
        schedule: { kind: "every", everyMs: 1_800_000 },
      }),
    ).toBe("a1b2c3");
    calls.length = 0;
    await schedules.save(settings, null, {
      name: "Brief",
      prompt: "Go",
      schedule: { kind: "every", everyMs: 1_800_000 },
    });
    await schedules.save(settings, "a1b2c3", {
      name: "Brief",
      prompt: "Go further",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });
    await schedules.setEnabled(settings, "a1b2c3", false);
    await schedules.setEnabled(settings, "a1b2c3", true);
    await schedules.runNow(settings, "a1b2c3");
    await schedules.remove(settings, "a1b2c3");
    expect(calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual([
      "POST /api/jobs",
      "GET /api/jobs/a1b2c3",
      "PATCH /api/jobs/a1b2c3",
      "POST /api/jobs/a1b2c3/pause",
      "POST /api/jobs/a1b2c3/resume",
      "POST /api/jobs/a1b2c3/run",
      "DELETE /api/jobs/a1b2c3",
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: "Brief",
      schedule: "every 30m",
      prompt: "Go",
      deliver: "local",
    });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      name: "Brief",
      schedule: "0 9 * * *",
      prompt: "Go further",
    });
  });

  it("doesn't send an unchanged schedule, which would push its next run back", async () => {
    const calls = serve(() => Response.json({ job }));
    await schedules.save(settings, "a1b2c3", {
      name: "Renamed",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      name: "Renamed",
      prompt: "Summarise my inbox",
    });
  });

  it("says why it failed", async () => {
    serve(() => Response.json({ error: "Cron module not available" }, { status: 501 }));
    await expect(schedules.list(settings)).rejects.toThrow(/doesn't run scheduled tasks/);
    serve(() => Response.json({ error: "Job not found" }, { status: 404 }));
    await expect(schedules.runNow(settings, "gone")).rejects.toThrow(/gone from Hermes/);
    serve(() => Response.json({ error: "Invalid schedule 'x'" }, { status: 400 }));
    await expect(
      schedules.save(settings, null, {
        name: "x",
        prompt: "x",
        schedule: { kind: "cron", expr: "x x x x x" },
      }),
    ).rejects.toThrow("Invalid schedule 'x'");
  });
});
