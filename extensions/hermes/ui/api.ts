import { ipc } from "@otter/web/extension-kit";
import type { ProvidersState } from "@otter/web/extension-kit";

export const hermesApi = {
  connectHermes: (params: { baseUrl: string; apiKey: string }): Promise<ProvidersState> =>
    ipc("agent:connectHermes", params),
};
