import { ipc } from "@otter/web/extension-kit";
import type { OpenRouterConnection } from "@otter/contracts/openrouter";
import type { ProvidersState } from "@otter/web/extension-kit";

export const openRouterApi = {
  openrouterConnection: (): Promise<OpenRouterConnection> => ipc("agent:openrouterConnection"),

  connectOpenRouter: (apiKey: string): Promise<ProvidersState> =>
    ipc("agent:connectOpenRouter", { apiKey }),

  disconnectOpenRouter: (): Promise<ProvidersState> => ipc("agent:disconnectOpenRouter"),
};
