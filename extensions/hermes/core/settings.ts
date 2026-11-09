import type { AgentSettings } from "@otter/core/extension-kit";

export type HermesSettings = AgentSettings & {
  baseUrl: string;
  agentModel: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  sessions?: boolean;
  /** Jobs whose results stay on Hermes rather than coming to Otter (comma-separated ids). */
  mutedJobs?: string;
};

export const HERMES_DEFAULTS: HermesSettings = {
  enabled: true,
  baseUrl: "",
  agentModel: "hermes-agent",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
};
