import { shortenPath, type ApprovalDecision } from "@sulti/core";
import { useEffect } from "react";
import { useApp } from "../appContext.js";
import { ago } from "../present.js";
import { sessionName } from "../state.js";
import { Icon } from "../ui/icons.js";
import { useSheetClose } from "../ui/Sheet.js";

export function ApprovalSheet({ requestId }: { requestId?: string }) {
  const { state, send } = useApp();
  const close = useSheetClose();
  const a = state.approvals.find((x) => x.requestId === requestId) ?? state.approvals[0];
  const more = state.approvals.length - (a ? 1 : 0);

  // Answered from somewhere else (or the turn ended): nothing left to decide here.
  useEffect(() => {
    if (!a) close();
  }, [a, close]);
  if (!a) return null;

  const respond = (decision: ApprovalDecision) => {
    if (send({ type: "approval.respond", requestId: a.requestId, decision })) close();
  };
  const command = a.kind === "command";

  return (
    <div className="sheet-body approval">
      <div className="approval-head">
        <span className="tile tile-coral">
          <Icon name={command ? "terminal" : "pencil"} size={24} stroke={1.9} />
        </span>
        <div>
          <h2 className="sheet-title">{command ? "Run this command?" : "Change these files?"}</h2>
          <p className="muted">
            {sessionName(state, a.sessionId)} asked {ago(a.receivedAt)}
          </p>
        </div>
      </div>
      <div className="cmd-box mono">{a.command ?? a.summary}</div>
      <dl className="kv">
        {a.reason && (
          <>
            <dt>Why</dt>
            <dd>{a.reason}</dd>
          </>
        )}
        <dt>Folder</dt>
        <dd className="mono">{a.cwd ? shortenPath(a.cwd) : a.sessionId}</dd>
      </dl>
      <div className="approval-actions">
        <button type="button" className="btn btn-outline btn-lg press" onClick={() => respond("decline")}>
          Decline
        </button>
        <button type="button" className="btn btn-primary btn-lg press" onClick={() => respond("accept")}>
          Approve once
        </button>
      </div>
      <button type="button" className="link-btn press" onClick={() => respond("acceptForSession")}>
        Approve for this session
      </button>
      <p className="fine center">
        <Icon name="lock" size={14} stroke={2.2} />
        <span>Only a tap can approve. Voice commands can't.</span>
      </p>
      {more > 0 && <p className="fine center">{more === 1 ? "1 more request is waiting." : more + " more requests are waiting."}</p>}
    </div>
  );
}

