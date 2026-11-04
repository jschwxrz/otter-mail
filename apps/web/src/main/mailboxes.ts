import { useEffect, useState } from "react";
import { aliasMailboxesOf, type AliasMailboxEntry } from "./mail/alias-mailboxes";
import { useAccounts } from "./mail/hooks";
import type { MailAccount } from "./mail/types";
import { setSyncedPreference } from "./synced-preferences";

/**
 * Accounts by address, alias mailboxes by id. An alias mailbox always follows its parent:
 * `order` ranks it only among the parent's others, and one not in it yet comes last of them.
 */
export type MailboxArrangement = {
  order: string[];
  off: string[];
};

export type MailboxTab = { id: string; account: MailAccount; alias?: AliasMailboxEntry };

const KEY = "mail:mailboxes";
const CHANGE_EVENT = "otter:mailboxes-change";

function read(): MailboxArrangement {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MailboxArrangement>;
    return { order: value.order ?? [], off: value.off ?? [] };
  } catch {
    return { order: [], off: [] };
  }
}

export function setMailboxArrangement(next: MailboxArrangement): void {
  setSyncedPreference(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useMailboxArrangement(): MailboxArrangement {
  const [arrangement, setArrangement] = useState(read);
  useEffect(() => {
    const update = () => setArrangement(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) update();
    };
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return arrangement;
}

function arrangeBy<T>(items: T[], keyOf: (item: T) => string, { order }: MailboxArrangement): T[] {
  const rank = (item: T) => {
    const i = order.indexOf(keyOf(item));
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, added) => ({ item, added }))
    .sort((x, y) => rank(x.item) - rank(y.item) || x.added - y.added)
    .map((x) => x.item);
}

export function arrangeAccounts(
  accounts: MailAccount[],
  arrangement: MailboxArrangement,
): MailAccount[] {
  return arrangeBy(accounts, (a) => a.email, arrangement);
}

/** `accounts`: all of them, turned off too. */
export function arrangeMailboxes(
  accounts: MailAccount[],
  arrangement: MailboxArrangement,
): MailboxTab[] {
  return arrangeAccounts(accounts, arrangement).flatMap((account) => [
    { id: account.id, account },
    ...arrangeBy(aliasMailboxesOf(account, accounts), (a) => a.id, arrangement).map((alias) => ({
      id: alias.id,
      account,
      alias,
    })),
  ]);
}

export const arrangementKey = (tab: MailboxTab): string => tab.alias?.id ?? tab.account.email;

export function useMailboxes(): {
  accounts: MailAccount[];
  tabs: MailboxTab[];
  aliases: AliasMailboxEntry[];
  isLoading: boolean;
} {
  const query = useAccounts();
  const arrangement = useMailboxArrangement();
  const tabs = arrangeMailboxes(query.data ?? [], arrangement).filter(
    (tab) =>
      !arrangement.off.includes(tab.account.email) &&
      !(tab.alias && arrangement.off.includes(tab.alias.id)),
  );
  return {
    accounts: tabs.flatMap((tab) => (tab.alias ? [] : [tab.account])),
    tabs,
    aliases: tabs.flatMap((tab) => (tab.alias ? [tab.alias] : [])),
    isLoading: query.isLoading,
  };
}
