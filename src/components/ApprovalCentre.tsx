"use client";

// The Approval Centre: every action a bot is waiting to run, every decision made,
// and the full audit log. Approving or rejecting here goes through the same
// recorded decision as the card in the chat.
import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { timeLabel } from "@/lib/client/format";
import { useApprovals } from "@/lib/client/use-approvals";
import type { ApprovalRecord, ApprovalStatus, AuditEntry, AuditEvent, ConversationId } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { BotAvatar, Button, Drawer, Tabs } from "./ui";

type Tab = "waiting" | "history" | "audit";

/** Audit events in plain words. A Record, so a new event type can't be forgotten here. */
const EVENT_TEXT: Record<AuditEvent, string> = {
  "approval.requested": "Asked for approval",
  "approval.approved": "You approved",
  "approval.rejected": "You rejected",
  "approval.expired": "Request expired",
  "tool.ran_auto": "Ran without asking",
  "tool.ran_approved": "Ran after approval",
  "tool.not_run": "Did not run",
  "limit.reached": "Daily limit reached",
};

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

/** "Chat with Scout" or the room's name, for a conversation id. */
function useConversationName() {
  const { state } = useApp();
  return (id: ConversationId) => {
    const [kind, ref] = id.split(":");
    if (kind === "dm") return `Chat with ${state.bots.find((b) => b.id === ref)?.name ?? "a deleted bot"}`;
    return state.rooms.find((r) => r.id === ref)?.name ?? "A deleted room";
  };
}

function BotName({ botId }: { botId: string }) {
  const { state } = useApp();
  const bot = state.bots.find((b) => b.id === botId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {bot && <BotAvatar bot={bot} size={22} />}
      <span className="truncate text-[13.5px] font-medium">{bot?.name ?? "Deleted bot"}</span>
    </span>
  );
}

function WaitingCard({ request }: { request: ApprovalRecord }) {
  const { toast, open, setPanel } = useApp();
  const conversationName = useConversationName();
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.decideApproval(request.id, approve);
      toast(approve ? "Approved. The bot is running the action now." : "Rejected. The action did not run.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send that.");
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl bg-warn-soft p-4 ring-1 ring-warn/30">
      <div className="flex items-center justify-between gap-2">
        <BotName botId={request.botId} />
        <span className="shrink-0 text-[12px] text-faint">{timeLabel(request.requestedAt)}</span>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[14px] font-medium text-warn">
        <ShieldAlert size={15} className="shrink-0" /> {request.label}
      </p>
      <button
        type="button"
        className="mt-1 text-[12.5px] text-mute hover:text-ink hover:underline"
        onClick={() => {
          open(request.conversationId);
          setPanel(null);
        }}
      >
        In: {conversationName(request.conversationId)}
      </button>
      <p className="mt-3 mb-1 text-[12px] font-medium text-mute">It will run with exactly these details:</p>
      <pre className="max-h-56 overflow-auto rounded-xl bg-raised px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
        {request.argsPreview}
      </pre>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(false)}>
          Reject
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
          Approve
        </Button>
      </div>
    </li>
  );
}

function HistoryRow({ request }: { request: ApprovalRecord }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <BotName botId={request.botId} />
        <span
          className={clsx(
            "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium",
            request.status === "approved" && "bg-ok/15 text-ok",
            request.status === "rejected" && "bg-danger-soft text-danger",
            request.status === "expired" && "bg-raised-2 text-mute",
          )}
        >
          {STATUS_TEXT[request.status]}
        </span>
      </div>
      <p className="mt-1 truncate text-[13px]">{request.label}</p>
      <p className="mt-0.5 text-[12px] text-faint">
        {timeLabel(request.decidedAt ?? request.requestedAt)}
        {request.decidedBy ? ` · ${request.status === "expired" ? request.decidedBy : `by ${request.decidedBy}`}` : ""}
      </p>
    </li>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { state } = useApp();
  const bot = state.bots.find((b) => b.id === entry.botId);
  const stoppedOrRejected = entry.event === "tool.not_run" || entry.event === "approval.rejected";
  return (
    <li className="grid grid-cols-[64px_1fr] gap-2 px-4 py-2.5 text-[12.5px]">
      <span className="text-faint tabular-nums" title={entry.at}>
        {new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="min-w-0">
        <span className={clsx("font-medium", stoppedOrRejected ? "text-danger" : "text-ink")}>{EVENT_TEXT[entry.event]}</span>
        <span className="text-mute"> · {bot?.name ?? "Deleted bot"}</span>
        {entry.toolName && <span className="block truncate font-mono text-[11.5px] text-faint">{entry.toolName}</span>}
        {entry.detail && <span className="block truncate text-mute">{entry.detail}</span>}
      </span>
    </li>
  );
}

export function ApprovalCentre({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const { data, error, loading } = useApprovals(state.approvalsVersion);
  const [tab, setTab] = useState<Tab>("waiting");
  const waiting = data?.pending.length ?? 0;

  return (
    <Drawer title="Approval Centre" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-mute">
        Actions in other systems (sending, creating, browsing) wait here for your OK, depending on each bot&apos;s permission level. A rejected action never
        runs.
      </p>
      <div className="mt-4 mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "waiting", label: waiting ? `Waiting (${waiting})` : "Waiting" },
            { value: "history", label: "History" },
            { value: "audit", label: "Audit log" },
          ]}
        />
      </div>

      {loading && <p className="py-6 text-center text-[13px] text-mute">Loading…</p>}
      {error && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}

      {data && tab === "waiting" && (
        <ul className="space-y-3">
          {data.pending.map((r) => (
            <WaitingCard key={r.id} request={r} />
          ))}
          {data.pending.length === 0 && <li className="py-6 text-center text-[13px] text-mute">Nothing is waiting for you.</li>}
        </ul>
      )}

      {data && tab === "history" && (
        <ul className="divide-y divide-line rounded-2xl bg-raised">
          {data.history.map((r) => (
            <HistoryRow key={r.id} request={r} />
          ))}
          {data.history.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-mute">No decisions yet.</li>}
        </ul>
      )}

      {data && tab === "audit" && (
        <>
          <p className="mb-2 text-[12px] text-faint">Every tool call, approval and decision, newest first. Entries are never changed or deleted.</p>
          <ul className="divide-y divide-line rounded-2xl bg-raised">
            {data.audit.map((e) => (
              <AuditRow key={e.id} entry={e} />
            ))}
            {data.audit.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-mute">Nothing logged yet.</li>}
          </ul>
        </>
      )}
    </Drawer>
  );
}

/** How many requests are waiting, for the sidebar badge. */
export function usePendingApprovalCount(): number {
  const { state } = useApp();
  const { data } = useApprovals(state.approvalsVersion);
  return data?.pending.length ?? 0;
}
