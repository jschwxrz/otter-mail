/** Where a relay host's sign-ins and CORS lead: its web app, and the domain its cookies cover. */
type RelayHost = { app: string; cookieDomain?: string };

type HostEnv = {
  /** JSON: other relay origins → their web app (and cookie domain), each with its own registered callbacks. */
  RELAY_HOSTS?: string;
  BETTER_AUTH_URL: string;
  APP_ORIGIN: string;
  COOKIE_DOMAIN?: string;
};

/**
 * The env as the relay host a request came in on sees it. BETTER_AUTH_URL's host keeps the env
 * as it is; another listed host builds its callbacks, CORS and cookies from its own origin.
 */
export function forHost<E extends HostEnv>(env: E, requestUrl: string): E {
  const origin = new URL(requestUrl).origin;
  if (!env.RELAY_HOSTS || origin === new URL(env.BETTER_AUTH_URL).origin) return env;
  const host = (JSON.parse(env.RELAY_HOSTS) as Record<string, RelayHost>)[origin];
  if (!host) return env;
  return {
    ...env,
    BETTER_AUTH_URL: origin,
    APP_ORIGIN: host.app,
    COOKIE_DOMAIN: host.cookieDomain,
  };
}
