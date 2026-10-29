import type { Answer } from "@sulti/core";
import { useEffect, useState } from "react";
import { useApp, type SheetSpec } from "../appContext.js";
import { ago, firstLine } from "../present.js";
import { Icon } from "../ui/icons.js";
import { Avatar } from "../ui/parts.js";
import { Sheet, useSheetClose } from "../ui/Sheet.js";
import { ApprovalSheet } from "./Approval.js";
import { SettingsSheet } from "./Settings.js";

const STATUS = { idle: "Idle", working: "Working", waitingApproval: "Needs approval", error: "Last turn failed" } as const;

function PickSession({ title, onPick }: { title: string; onPick: (id: string) => void }) {
  const { state } = useApp();
  const close = useSheetClose();
  return (
    <div className="sheet-body">
      <h2 className="sheet-title">{title}</h2>
      <ul className="group">
        {state.sessions
          .filter((s) => !s.unlisted)
          .map((s) => (
            <li key={s.id} className="row">
              <button type="button" className="row-main press-row" onClick={() => (onPick(s.id), close())}>
                <Avatar session={s} />
                <span className="row-text">
                  <span className="row-title">{s.name}</span>
                  <span className="row-detail">{STATUS[s.status]}</span>
                </span>
                {s.id === state.activeSessionId && <span className="tag">Active</span>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

function Skills({ sessionId, onPick }: { sessionId: string; onPick: (skill: string) => void }) {
  const { state } = useApp();
  const close = useSheetClose();
  const [filter, setFilter] = useState("");
  const all = state.skills[sessionId] ?? [];
  const q = filter.trim().toLowerCase();
  // Name matches first, then skills that only mention the word in their description.
  const shown = q ? [...all.filter((s) => s.name.toLowerCase().includes(q)), ...all.filter((s) => !s.name.toLowerCase().includes(q) && s.description.toLowerCase().includes(q))] : all;
  return (
    <div className="sheet-body">
      <h2 className="sheet-title">Skills</h2>
      <input className="field" type="search" value={filter} placeholder={"Filter " + all.length + " skills"} aria-label="Filter skills" onChange={(e) => setFilter(e.target.value)} />
      {!shown.length && <p className="muted">{all.length ? "No skill matches “" + filter + "”." : "No skills in this project."}</p>}
      <ul className="group">
        {shown.map((k) => (
          <li key={k.path || k.name} className="row">
            <button type="button" className="row-main press-row" onClick={() => (onPick(k.name), close())}>
              <span className="row-text">
                <span className="mono skill-name truncate">{k.name}</span>
                {k.description && <span className="row-detail clamp-2">{k.description}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Threads({ sessionId }: { sessionId: string }) {
  const { state, send } = useApp();
  const close = useSheetClose();
  const session = state.sessions.find((s) => s.id === sessionId);
  const threads = state.threads[sessionId];
  useEffect(() => {
    send({ type: "thread.list", sessionId });
  }, [send, sessionId]);
  return (
    <div className="sheet-body">
      <h2 className="sheet-title">Continue a conversation</h2>
      <p className="muted">Pick a Codex thread from this folder. New prompts from your phone will continue it.</p>
      {!threads ? (
        <span className="sk sk-line" aria-label="Loading threads" />
      ) : !threads.length ? (
        <p className="muted">No threads in this folder yet.</p>
      ) : (
        <ul className="group">
          {threads.map((t) => {
            const current = t.id === session?.threadId;
            return (
              <li key={t.id} className="row">
                <button type="button" className="row-main press-row" disabled={current} onClick={() => send({ type: "thread.attach", sessionId, threadId: t.id }) && close()}>
                  <span className="row-text">
                    <span className="row-title clamp-2">{t.name ?? firstLine(t.preview || "Untitled thread", 120)}</span>
                    <span className="row-detail">{(current ? "Attached, " : "") + ago(t.updatedAt)}</span>
                  </span>
                  {current && <Icon name="check" size={20} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Confirm({ echo, onAnswer }: { echo: string; onAnswer: (accept: boolean) => void }) {
  const close = useSheetClose();
  const answer = (accept: boolean) => (onAnswer(accept), close());
  return (
    <div className="sheet-body">
      <h2 className="sheet-title">Did I get that right?</h2>
      <p className="confirm-echo">{echo}</p>
      <div className="approval-actions">
        <button type="button" className="btn btn-outline btn-lg press" onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-lg press" onClick={() => answer(true)}>
          Yes, do it
        </button>
      </div>
    </div>
  );
}

function Copy({ answer }: { answer: Answer }) {
  const { send, copyOnPhone } = useApp();
  const close = useSheetClose();
  return (
    <div className="sheet-body">
      <h2 className="sheet-title">Copy this answer</h2>
      <div className="stack">
        <button type="button" className="btn btn-primary btn-lg press" onClick={() => (copyOnPhone(answer.text), close())}>
          Copy on this phone
        </button>
        <button type="button" className="btn btn-outline btn-lg press" onClick={() => (send({ type: "answer.copyToPc", answerId: answer.id }), close())}>
          Copy to the PC clipboard
        </button>
      </div>
    </div>
  );
}

const LABEL: Record<SheetSpec["kind"], string> = {
  approval: "Approval",
  settings: "Settings",
  pickSession: "Choose a session",
  skills: "Skills",
  threads: "Threads",
  confirm: "Confirm",
  copy: "Copy",
};

/** Renders whichever sheet is open. Sheets close with their exit animation. */
export function SheetHost() {
  const { sheet, closeSheet } = useApp();
  if (!sheet) return null;
  return (
    <Sheet key={sheet.kind + ("requestId" in sheet ? sheet.requestId : "")} label={LABEL[sheet.kind]} onClose={closeSheet}>
      {sheet.kind === "approval" && <ApprovalSheet requestId={sheet.requestId} />}
      {sheet.kind === "settings" && <SettingsSheet />}
      {sheet.kind === "pickSession" && <PickSession title={sheet.title} onPick={sheet.onPick} />}
      {sheet.kind === "skills" && <Skills sessionId={sheet.sessionId} onPick={sheet.onPick} />}
      {sheet.kind === "threads" && <Threads sessionId={sheet.sessionId} />}
      {sheet.kind === "confirm" && <Confirm echo={sheet.echo} onAnswer={sheet.onAnswer} />}
      {sheet.kind === "copy" && <Copy answer={sheet.answer} />}
    </Sheet>
  );
}

