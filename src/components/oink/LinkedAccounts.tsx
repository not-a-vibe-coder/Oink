/**
 * Email and X linking, shared by Settings and the claim-your-tag prompt.
 *
 * Everything that needs Privy sits under <PrivyGate>, so without VITE_PRIVY_APP_ID the
 * same controls render disabled with a plain explanation instead of breaking the page.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PrivyGate } from "@/lib/privy/PrivyGate";
import { privyAvailable } from "@/lib/privy/config";
import { useIdentityProof, type ProofPurpose } from "@/lib/privy/useIdentityProof";
import { getIdentityLinks, linkIdentity, unlinkIdentity } from "@/lib/oink-server-fns";
import type { IdentityLinks } from "@/types/api";

const identityQueryKey = ["identity"] as const;

type Notice = { tone: "seal" | "danger"; text: string } | null;

function useIdentityLinks() {
  return useQuery({ queryKey: identityQueryKey, queryFn: () => getIdentityLinks() });
}

function tagMessage(outcome: string | undefined, links: IdentityLinks): string {
  const handle = links.x ? `@${links.x.username}` : "Your X account";
  if (outcome === "assigned") return `X linked. You're @${links.tag} now — people can pay you there.`;
  if (outcome === "invalid") return `X linked. ${handle} can't be a tag (tags are 3–20 letters, numbers or _).`;
  if (outcome === "reserved") return `X linked. ${handle} is a reserved name, so it can't be a tag.`;
  return "X linked.";
}

/** Runs a proof through Privy and posts it; owns the resulting message. */
function useLinker(purposes: ProofPurpose[]) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice>(null);

  const proof = useIdentityProof({
    purposes,
    onProof: async (purpose, identityToken) => {
      const kind = purpose === "link-x" ? "x" : "email";
      const result = await linkIdentity({ data: { kind, identityToken } });
      if (!result.ok) {
        console.error(`[oink:privy] API refused the ${kind} link — ${result.code}: ${result.message}`);
        setNotice({ tone: "danger", text: result.message });
        return;
      }
      queryClient.setQueryData(identityQueryKey, result.data);
      // The tag shows in the header and on Receive, which read the session.
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      const waiting = result.data.claiming ?? 0;
      const claimNote =
        waiting > 0
          ? ` ${waiting} payment${waiting === 1 ? " was" : "s were"} waiting for you — ${waiting === 1 ? "it's" : "they're"} on the way to your wallet now.`
          : "";
      if (waiting > 0) void queryClient.invalidateQueries({ queryKey: ["held"] });
      setNotice({
        tone: "seal",
        text: (kind === "x" ? tagMessage(result.data.tagOutcome, result.data) : `${result.data.email} is linked.`) + claimNote,
      });
    },
    onError: (text) => setNotice({ tone: "danger", text }),
  });

  return { ...proof, notice, setNotice };
}

// ── Settings section ───────────────────────────────────────────────────────

function Row({
  title,
  status,
  note,
  action,
}: {
  title: string;
  status: string | null;
  note: string;
  action: React.ReactNode;
}) {
  return (
    <div className="row-between" style={{ gap: "var(--s3)" }}>
      <div style={{ minWidth: 0 }}>
        <p className="ledger-title">
          {title}
          {status && <span className="meta"> · {status}</span>}
        </p>
        <p className="meta" style={{ marginTop: 4 }}>
          {note}
        </p>
      </div>
      {action}
    </div>
  );
}

function ConnectionsView({
  links,
  start,
  ready,
  busy,
  notice,
  onUnlink,
  unlinking,
}: {
  links: IdentityLinks | undefined;
  start?: (purpose: ProofPurpose) => void;
  ready: boolean;
  busy: boolean;
  notice: Notice;
  onUnlink: (kind: "email" | "x") => void;
  unlinking: "email" | "x" | null;
}) {
  const configured = privyAvailable && links?.configured !== false;
  const disabled = !configured || !ready || busy || !start;

  return (
    <div className="panel stack-tight">
      <Row
        title="X"
        status={links?.x ? `@${links.x.username}` : null}
        note={
          links?.x
            ? "Your tag comes from this account. Unlinking keeps your tag."
            : "Link X to claim your tag — your X username becomes your @tag."
        }
        action={
          links?.x ? (
            <button type="button" className="btn btn-quiet btn-sm" disabled={unlinking !== null} onClick={() => onUnlink("x")}>
              {unlinking === "x" ? "Unlinking…" : "Unlink"}
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => start?.("link-x")}>
              {busy ? "Waiting for X…" : "Link X"}
            </button>
          )
        }
      />
      <hr className="rule" />
      <Row
        title="Email"
        status={links?.email ?? null}
        note={
          links?.email
            ? "People can pay you at this address."
            : "Link an email so people can pay you at it. We send a code to prove it's yours."
        }
        action={
          links?.email ? (
            <button type="button" className="btn btn-quiet btn-sm" disabled={unlinking !== null} onClick={() => onUnlink("email")}>
              {unlinking === "email" ? "Unlinking…" : "Unlink"}
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => start?.("link-email")}>
              Link email
            </button>
          )
        }
      />
      {!configured && (
        <p className="footnote">Linking isn't switched on yet. Everything else in Oink works without it.</p>
      )}
      {notice && (
        <div className="callout" data-tone={notice.tone} role="status">
          {notice.text}
        </div>
      )}
    </div>
  );
}

function useUnlink() {
  const queryClient = useQueryClient();
  const [unlinking, setUnlinking] = useState<"email" | "x" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function unlink(kind: "email" | "x") {
    setUnlinking(kind);
    setError(null);
    const result = await unlinkIdentity({ data: { kind } });
    setUnlinking(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    queryClient.setQueryData(identityQueryKey, result.data);
    await queryClient.invalidateQueries({ queryKey: ["session"] });
  }
  return { unlink, unlinking, error };
}

function LiveConnections() {
  const links = useIdentityLinks();
  const linker = useLinker(["link-email", "link-x"]);
  const { unlink, unlinking, error } = useUnlink();
  return (
    <ConnectionsView
      links={links.data}
      start={(purpose) => void linker.start(purpose)}
      ready={linker.ready}
      busy={linker.busy}
      notice={error ? { tone: "danger", text: error } : linker.notice}
      onUnlink={(kind) => void unlink(kind)}
      unlinking={unlinking}
    />
  );
}

function StaticConnections() {
  const links = useIdentityLinks();
  const { unlink, unlinking, error } = useUnlink();
  return (
    <ConnectionsView
      links={links.data}
      ready={false}
      busy={false}
      notice={error ? { tone: "danger", text: error } : null}
      onUnlink={(kind) => void unlink(kind)}
      unlinking={unlinking}
    />
  );
}

export function LinkedAccounts() {
  return (
    <PrivyGate fallback={<StaticConnections />}>
      <LiveConnections />
    </PrivyGate>
  );
}

// ── Claim-your-tag prompt ──────────────────────────────────────────────────

function ClaimTagLive({ onDone }: { onDone: () => void }) {
  const linker = useLinker(["link-x"]);
  const succeeded = linker.notice?.tone === "seal";
  return (
    <div className="stack-tight">
      {linker.notice && (
        <div className="callout" data-tone={linker.notice.tone} role="status">
          {linker.notice.text}
        </div>
      )}
      {succeeded ? (
        <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
          Done
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!linker.ready || linker.busy}
          onClick={() => void linker.start("link-x")}
        >
          {linker.busy ? "Waiting for X…" : "Link X"}
        </button>
      )}
    </div>
  );
}

export function ClaimTagAction({ onDone }: { onDone: () => void }) {
  return (
    <PrivyGate
      fallback={
        <button type="button" className="btn btn-primary btn-block" disabled>
          {privyAvailable ? "Loading…" : "Linking isn't switched on yet"}
        </button>
      }
    >
      <ClaimTagLive onDone={onDone} />
    </PrivyGate>
  );
}
