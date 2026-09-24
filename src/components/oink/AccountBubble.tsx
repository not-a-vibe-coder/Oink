import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/oink/CopyButton";
import { PigAvatar } from "@/components/oink/PigAvatar";
import { useKeySession } from "@/hooks/useKeySession";
import { getIdentityLinks } from "@/lib/oink-server-fns";
import { shortAddress } from "@/lib/format";
import { lock } from "@/lib/wallet/key-session";

/**
 * The pig in the top bar is the whole identity: tap it for the account ID, the linked
 * X and email, and the address, in a bubble hung just beneath it. Lock lives here too,
 * now that the bar no longer carries a lock button of its own.
 */
export function AccountBubble({
  accountId,
  address,
  avatarSeed,
}: {
  accountId: string;
  address: string;
  avatarSeed: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { unlocked } = useKeySession();
  // Same key as LinkedAccounts, so linking in Settings updates the bubble without a refetch.
  const links = useQuery({ queryKey: ["identity"], queryFn: () => getIdentityLinks(), enabled: open });

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const x = links.data?.x?.username;
  const email = links.data?.email;
  const pending = links.isPending;

  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="account-pig"
        aria-label="Your account"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <PigAvatar seed={avatarSeed} size={34} />
      </button>

      {open && (
        <div className="account-bubble" role="dialog" aria-label="Your account">
          <dl className="account-rows">
            <div className="account-row">
              <dt>Oink ID</dt>
              <dd className="tnum">{accountId}</dd>
              <CopyButton value={accountId} />
            </div>
            <div className="account-row">
              <dt>X</dt>
              <dd data-empty={!x || undefined}>{pending ? "…" : x ? `@${x}` : "Not linked"}</dd>
            </div>
            <div className="account-row">
              <dt>Email</dt>
              <dd data-empty={!email || undefined}>{pending ? "…" : (email ?? "Not linked")}</dd>
            </div>
            <div className="account-row">
              <dt>Address</dt>
              <dd className="tnum" title={address}>
                {shortAddress(address)}
              </dd>
              <CopyButton value={address} />
            </div>
          </dl>
          <div className="account-foot">
            <Link to="/app/settings" className="link" onClick={() => setOpen(false)}>
              Linked accounts
            </Link>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                lock();
                setOpen(false);
              }}
              disabled={!unlocked}
              title={unlocked ? "Clear the key held in this tab" : "The key is not in memory"}
            >
              <Lock size={14} aria-hidden="true" />
              <span>{unlocked ? "Lock" : "Locked"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
