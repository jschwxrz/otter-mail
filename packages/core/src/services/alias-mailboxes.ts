import { validAliasMailboxes, type AliasMailbox } from "@otter-mail/contracts";

import { getAccount, isAccountId, listAccounts } from "./account-store.js";
import { addressList, type AliasScope } from "./mail-store.js";
import type { MailAccount, MessageSummary } from "../types.js";

export function parseAliasMailboxes(value: unknown): AliasMailbox[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): AliasMailbox[] => {
    const fields = (entry ?? {}) as Record<string, unknown>;
    const text = (key: string) =>
      typeof fields[key] === "string" && fields[key].trim() ? fields[key] : undefined;
    const address = text("address")?.trim();
    if (!address?.includes("@") || seen.has(address.toLowerCase())) return [];
    seen.add(address.toLowerCase());
    const [name, color, signature] = [text("name"), text("color"), text("signature")];
    return [
      {
        address,
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(signature ? { signature } : {}),
      },
    ];
  });
}

/** The alias mailbox a message is for: the first of theirs in To, then in Cc, then where it was delivered. */
export function aliasMailboxFor(
  aliases: AliasMailbox[],
  message: Pick<MessageSummary, "to" | "cc" | "deliveredTo">,
): AliasMailbox | undefined {
  const byAddress = new Map(aliases.map((alias) => [alias.address.toLowerCase(), alias]));
  const first = (list: string | undefined) =>
    addressList(list ?? "")
      .map((address) => byAddress.get(address))
      .find(Boolean);
  return (
    first(message.to) ??
    first(message.cc) ??
    message.deliveredTo?.map((address) => byAddress.get(address)).find(Boolean)
  );
}

export function aliasScopeOf(parent: MailAccount | null, alias: string): AliasScope {
  return {
    address: alias.toLowerCase(),
    sendAs: (parent?.sendAs ?? []).map((a) => a.toLowerCase()),
  };
}

export async function aliasScope(accountId: string, alias: string): Promise<AliasScope> {
  return aliasScopeOf(await getAccount(accountId), alias);
}

export async function resolveMailbox(
  id: string,
): Promise<{ accountId: string; alias?: AliasScope }> {
  if (isAccountId(id)) return { accountId: id };
  const accounts = await listAccounts();
  if (accounts.some((a) => a.id === id)) return { accountId: id };
  const emails = accounts.map((a) => a.email);
  const parent = accounts.find((account) =>
    validAliasMailboxes(account, emails).some((alias) => alias.address.toLowerCase() === id),
  );
  return parent ? { accountId: parent.id, alias: aliasScopeOf(parent, id) } : { accountId: id };
}
