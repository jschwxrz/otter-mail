import { useRef, useState, type DragEvent } from "react";
import { AccountPicture } from "../mail/account-picture";
import { useUpdateAccount } from "../mail/hooks";
import { toast } from "../mail/toast";
import type { MailAccount } from "../mail/types";
import { Btn, cn } from "../mail/ui";
import { PictureError, mailboxPicture } from "./mailbox-picture-image";
import { SettingsRow } from "./settings-ui";
import { searchableSetting } from "./settings-search";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

export function MailboxPictureRow({ account }: { account: MailAccount }) {
  const updateAccount = useUpdateAccount();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dropping, setDropping] = useState(false);

  const save = (customPicture: string) =>
    updateAccount.mutateAsync({ accountId: account.id, customPicture }).catch((err: unknown) => {
      toast.error("Couldn't save the picture", {
        description: err instanceof Error ? err.message : String(err),
      });
    });

  const use = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      await save(await mailboxPicture(file));
    } catch (err) {
      toast.error("Couldn't use that picture", {
        description:
          err instanceof PictureError
            ? err.message
            : "Couldn't read it. Choose a PNG, JPEG or WebP.",
      });
    } finally {
      setReading(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("mailbox-picture")}
      description={`Shown in the sidebar and wherever this mailbox appears, instead of its ${account.picture ? "profile picture" : "initial"}. Only used in Otter Mail.`}
      className={cn("transition-colors", dropping && "bg-accent-surface")}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        void use(event.dataTransfer.files[0]);
      }}
      control={
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            aria-label={`Picture for ${account.email}`}
            onChange={(event) => {
              void use(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <AccountPicture account={account} className="size-8 rounded-lg text-xs" />
          <Btn size="sm" disabled={reading} onClick={() => input.current?.click()}>
            {account.customPicture ? "Change…" : "Choose…"}
          </Btn>
          {account.customPicture ? (
            <Btn size="sm" disabled={reading} onClick={() => void save("")}>
              Remove
            </Btn>
          ) : null}
        </>
      }
    />
  );
}
