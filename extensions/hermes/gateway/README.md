# Otter for Hermes

A Hermes Agent plugin that makes Otter a delivery channel, `otter`: what Hermes sends you, a
scheduled job's result or a message from your agent, becomes a chat in Otter.

Each delivery is kept on your Hermes, as a session Otter reads through Hermes's API server, the
way it reads your other Hermes chats. Otter's relay is told only which chat to read, so your
devices can show it; it never carries the text.

## Install

On the machine that runs your Hermes gateway:

```sh
hermes plugins install otterware-app/otter/extensions/hermes/gateway --enable --yes-deps
```

`--yes-deps` installs the plugin's one dependency, `aiohttp`, without asking. Without
`--enable` the installer asks whether to enable it; `hermes plugins enable otter` enables it
later. The installer may also ask for the two settings below; skip them there and set them next.

## Set up

Otter's Hermes settings give you a channel token (`otter_ch_…`). Then:

```sh
hermes config set OTTER_RELAY_URL https://relay.otterware.app
hermes config set OTTER_CHANNEL_TOKEN otter_ch_…
hermes gateway restart
```

Both go to `~/.hermes/.env`. The gateway's log then says `✓ otter connected`, and the API
server's `/health/detailed` lists `otter` as connected.

## Where deliveries go

| Target               | Goes to                                             |
| -------------------- | --------------------------------------------------- |
| `otter`              | The home chat, `OTTER_HOME_CHANNEL` (default `new`) |
| `otter:new`          | A new chat in Otter for each delivery               |
| `otter:<session id>` | That chat (a Hermes session, one of Otter's chats)  |

A scheduled job delivering to a new chat titles it with the job's name ("Morning brief",
"Morning brief #2", …); other deliveries are titled "Hermes". For example:

```sh
hermes cron create "0 7 * * *" "Write my morning brief" --name "Morning brief" --deliver otter
hermes send -t otter "Your build finished."
```

`hermes config set OTTER_HOME_CHANNEL <session id>` sends `otter` deliveries to one chat
instead of a new one each time.

Hermes 0.19 (the release on PyPI) takes only `otter`: the `otter:…` targets need a newer Hermes.

## Develop

```sh
uv run --no-project --with hermes-agent==0.19.0 --with aiohttp --with pytest \
  pytest --import-mode=importlib extensions/hermes/gateway/tests
```

CI runs this when the plugin changes. Against a newer Hermes, use its checkout's
`.venv/bin/python -m pytest --import-mode=importlib …` instead.
