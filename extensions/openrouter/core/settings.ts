import type { AgentSettings, RuntimeMode } from "@otter/core/extension-kit";

export type OpenRouterSettings = AgentSettings & {
  reasoningEffort: string;
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export const OPENROUTER_DEFAULTS: OpenRouterSettings = {
  enabled: true,
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "approval-required",
};
