import { useState } from "react";
import {
  ClockIcon,
  CopyIcon,
  FileIcon,
  FilePenLineIcon,
  GlobeIcon,
  ListTodoIcon,
  MailIcon,
} from "lucide-react";
import type { ChatTab } from "@otter/contracts/chats";
import type { ScheduledTask } from "@otter/contracts/scheduled";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { AgentAvatar, openClawAgentId, useChatProvider } from "./agent-providers";
import { keyOf, useScheduledTasks } from "./agent-scheduled";
import { isOpenTab, type Conversation } from "./chat-store";
import { scheduleText, untilText } from "./scheduled-text";
import { toast } from "./toast";
import { HintTooltip, cn } from "./ui";

export const TAB_ICONS = {
  thread: MailIcon,
  draft: FilePenLineIcon,
  page: GlobeIcon,
  file: FileIcon,
};

/** What the agent made: a draft, a file, an event; the rest is what it read. */
export const isOutput = (tab: ChatTab) =>
  tab.made ?? (tab.ref.kind === "draft" || tab.ref.kind === "file");

const SHOWN = 5;

/** The chat's context: the agent and session it runs in, and what it made and used, closed tabs included. */
export function ChatContextButton({
  convo,
  onOpen,
  onOpenTask,
}: {
  convo: Conversation;
  onOpen: (tab: ChatTab) => void;
  /** Opens one of the agent's scheduled tasks in Scheduled. */
  onOpenTask: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chatAgent = useChatProvider(convo);
  const agent = openClawAgentId(convo.sessionId);
  const agentName =
    (agent ? (chatAgent.provider?.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
    chatAgent.name;
  // A local agent runs on the device that has the chat; a gateway, where it answers.
  const where =
    convo.device?.name ??
    (chatAgent.provider?.status === "ready" ? chatAgent.provider.message : null);
  const outputs = convo.tabs.filter(isOutput).toReversed();
  const sources = convo.tabs.filter((t) => !isOutput(t)).toReversed();
  const choose = (tab: ChatTab) => {
    setOpen(false);
    onOpen(tab);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Chat details" side="bottom">
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Chat details"
              className={cn(
                "no-drag flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring",
                open && "bg-foreground/[0.06] text-foreground",
              )}
            >
              <ListTodoIcon className="size-4" />
            </button>
          }
        />
      </HintTooltip>
      <PopoverPopup align="end" padding="compact" width="md">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2 px-1">
            <AgentAvatar kind={convo.provider} agent={agent} />
            <span className="min-w-0 truncate font-medium text-foreground">{agentName}</span>
            {agent || where ? (
              <span className="min-w-0 truncate text-muted-foreground">
                {[agent ? chatAgent.name : null, where].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
          {convo.sessionId ? (
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <span className="shrink-0">Session</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={convo.sessionId}>
                {convo.sessionId}
              </span>
              <button
                type="button"
                aria-label="Copy session"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-foreground/[0.06] hover:text-foreground"
                onClick={() =>
                  void navigator.clipboard.writeText(convo.sessionId ?? "").then(
                    () => toast.success("Session copied"),
                    () => toast.error("Couldn't copy the session"),
                  )
                }
              >
                <CopyIcon className="size-3.5" />
              </button>
            </div>
          ) : null}
          {convo.sessionId ? (
            <ScheduledSection
              sessionId={convo.sessionId}
              onOpen={(key) => {
                setOpen(false);
                onOpenTask(key);
              }}
            />
          ) : null}
          <TabSection title="Outputs" empty="Nothing made yet" tabs={outputs} onOpen={choose} />
          <TabSection title="Sources" empty="Nothing read yet" tabs={sources} onOpen={choose} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function TabSection({
  title,
  empty,
  tabs,
  onOpen,
}: {
  title: string;
  empty: string;
  tabs: ChatTab[];
  onOpen: (tab: ChatTab) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? tabs : tabs.slice(0, SHOWN);
  return (
    <section className="flex flex-col gap-0.5 border-t pt-2">
      <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {tabs.length === 0 ? <p className="px-1 text-xs text-muted-foreground/70">{empty}</p> : null}
      {shown.map((tab) => {
        const Icon = TAB_ICONS[tab.ref.kind];
        const detail = tab.ref.kind === "page" ? tab.ref.url : undefined;
        return (
          <button
            key={tab.id}
            type="button"
            title={detail ? `${tab.title}\n${detail}` : tab.title}
            onClick={() => onOpen(tab)}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-focus-ring",
              isOpenTab(tab) ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{tab.title}</span>
          </button>
        );
      })}
      {tabs.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="cursor-pointer self-start rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {all ? "Show fewer" : `View all ${tabs.length}`}
        </button>
      ) : null}
    </section>
  );
}

/** What the agent runs on a schedule for this chat: made in it, or posting to it. */
function ScheduledSection({
  sessionId,
  onOpen,
}: {
  sessionId: string;
  onOpen: (key: string) => void;
}) {
  const { data } = useScheduledTasks(true);
  const tasks = (data ?? []).flatMap((agent) =>
    agent.tasks.filter((task) => task.chats?.includes(sessionId)),
  );
  if (tasks.length === 0) return null;
  const now = Date.now();
  return (
    <section className="flex flex-col gap-0.5 border-t pt-2">
      <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground">Scheduled</h3>
      {tasks.map((task) => (
        <button
          key={keyOf(task)}
          type="button"
          onClick={() => onOpen(keyOf(task))}
          className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ClockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-foreground">{task.name}</span>
            <span className="truncate text-xs text-muted-foreground">{taskLine(task, now)}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

function taskLine(task: ScheduledTask, now: number): string {
  const when = scheduleText(task.schedule);
  if (!task.enabled) return `${when} · Paused`;
  if (task.running) return `${when} · Running now`;
  return task.nextRunAt ? `${when} · next ${untilText(task.nextRunAt, now)}` : when;
}
