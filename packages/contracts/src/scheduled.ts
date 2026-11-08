/** When a scheduled task runs. `text` is the agent's own wording for one Otter can't edit. */
export type TaskSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  /** Once, at an ISO time. */
  | { kind: "at"; at: string }
  | { kind: "other"; text: string };

export type TaskRunStatus = "ok" | "error" | "skipped";

/** Where a task's result goes. */
export type TaskDelivery =
  | { kind: "otter"; chat: "new" | "one" }
  | { kind: "none" }
  | { kind: "elsewhere"; label: string };

/** A task an agent runs on its own, on a schedule. */
export interface ScheduledTask {
  provider: string;
  id: string;
  /** Which of the provider's agents runs it (an OpenClaw agent: a model slug of the provider's). */
  agent?: string;
  name: string;
  description?: string;
  /** What it asks the agent; absent when it isn't a message (a heartbeat, a command). */
  prompt?: string;
  schedule: TaskSchedule;
  enabled: boolean;
  running: boolean;
  nextRunAt?: number;
  lastRun?: { at: number; status: TaskRunStatus; error?: string; durationMs?: number };
  delivery: TaskDelivery;
  /** Kept by the agent itself or one of its plugins (OpenClaw's heartbeat): it can be paused and run, not changed. */
  managedBy?: string;
  /** Why the agent paused it on its own. */
  autoPaused?: string;
  /** The version of it shown, so a save doesn't overwrite a change made since. */
  revision?: string;
  /** Its results can't be sent anywhere (an OpenClaw task in a shared session). */
  undeliverable?: true;
}

/** One agent's tasks, or why they couldn't be read. */
export interface AgentScheduledTasks {
  provider: string;
  tasks: ScheduledTask[];
  error?: string;
  /** Why tasks can be read but not changed (the gateway didn't give Otter full access). */
  readOnly?: string;
  /** What the agent can do with them beyond listing, pausing, running and deleting. */
  can: {
    create: boolean;
    /** Results can come to Otter as chats. */
    deliverToOtter: boolean;
    /** Past runs, each with its transcript. */
    history: boolean;
    /** Schedules it understands; cron with a time zone. */
    timeZones: boolean;
  };
}

export interface ScheduledTaskInput {
  name: string;
  prompt?: string;
  schedule: Exclude<TaskSchedule, { kind: "other" }>;
  agent?: string;
  /** Where its results go: a new Otter chat each run, or nowhere. Unset leaves them where they go (this chat, another channel). */
  resultsTo?: "new-chat" | "off";
  /** The version edited (`ScheduledTask.revision`). */
  revision?: string;
}

export interface TaskRun {
  id: string;
  at: number;
  status: TaskRunStatus;
  durationMs?: number;
  error?: string;
  summary?: string;
  model?: string;
  delivered?: boolean;
  /** The agent chose to send nothing this time. */
  silent?: true;
}
