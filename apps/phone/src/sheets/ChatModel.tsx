import { useEffect, useRef, useState } from "react";
import { useApp } from "../appContext.js";
import { effortLabel, modelTitle } from "../present.js";
import { Icon } from "../ui/icons.js";
import { ChatSkeletonRows } from "../ui/parts.js";
import { useSheetClose } from "../ui/Sheet.js";

/** Model and reasoning effort for a session's current chat. Codex switches with the chat's next message. */
export function ChatModelSheet({ sessionId }: { sessionId: string }) {
  const { state, send, notify } = useApp();
  const close = useSheetClose();
  const s = state.sessions.find((x) => x.id === sessionId);
  const models = state.models;
  // Local picks; until you tap, the chat's current model and effort (a new chat: Codex's default).
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  useEffect(() => {
    send({ type: "models.list" });
  }, [send]);
  // Open on the chat's current model, which can sit far down a long list.
  const list = useRef<HTMLUListElement>(null);
  const loaded = !!models;
  useEffect(() => {
    list.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "center" });
  }, [loaded]);

  const pickedId = model ?? s?.model ?? models?.find((m) => m.isDefault)?.id;
  const picked = models?.find((m) => m.id === pickedId);
  const keepsModel = !!s?.model && picked?.id === s.model;
  const chosenEffort = effort && picked?.efforts.includes(effort) ? effort : keepsModel && s?.effort ? s.effort : (picked?.defaultEffort ?? null);
  const changed = !!picked && (picked.id !== s?.model || chosenEffort !== (s?.effort ?? null));

  const done = () => {
    if (changed && picked) {
      if (!send({ type: "chat.settings", sessionId, model: picked.id, effort: chosenEffort })) return;
      notify("info", modelTitle(picked.name) + (chosenEffort ? ", " + effortLabel(chosenEffort).toLowerCase() + " effort," : "") + " from your next message.");
    }
    close();
  };

  return (
    <div className="sheet-body">
      <h2 className="sheet-title">Model for this chat</h2>
      <p className="muted">Starts with your next message in this chat, and stays with it.</p>
      {picked && picked.efforts.length > 0 && (
        <>
          <h3 className="section-title">Reasoning effort</h3>
          <div className="chips" role="radiogroup" aria-label="Reasoning effort">
            {picked.efforts.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={e === chosenEffort} className={"skill-chip press" + (e === chosenEffort ? " on" : "")} onClick={() => setEffort(e)}>
                {effortLabel(e)}
              </button>
            ))}
          </div>
        </>
      )}
      <h3 className="section-title">Model</h3>
      {!models ? (
        <ul className="group" aria-busy="true" aria-label="Loading models">
          <ChatSkeletonRows />
        </ul>
      ) : (
        <ul ref={list} className="group" role="radiogroup" aria-label="Model">
          {models.map((m) => {
            const on = m.id === picked?.id;
            return (
              <li key={m.id} className="row">
                <button type="button" role="radio" aria-checked={on} className="row-main press-row" onClick={() => setModel(m.id)}>
                  <span className="row-text">
                    <span className="row-title truncate">{modelTitle(m.name)}</span>
                    {(m.isDefault || m.name.includes("/")) && <span className="row-detail">{[m.isDefault && "Codex default", m.name.includes("/") && m.name.split("/")[0]].filter(Boolean).join(", ")}</span>}
                  </span>
                  {on && <Icon name="check" size={20} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary btn-lg press" disabled={!picked} onClick={done}>
          {changed ? "Use for this chat" : "Done"}
        </button>
      </div>
    </div>
  );
}
