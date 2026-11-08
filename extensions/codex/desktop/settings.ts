import type { AgentSettings, RuntimeMode } from "@otter/core/extension-kit";

export type CodexSettings = AgentSettings & {
  binaryPath: string;
  homePath: string;
  launchArgs: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export const CODEX_DEFAULTS: CodexSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  launchArgs: "",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "full-access",
};
