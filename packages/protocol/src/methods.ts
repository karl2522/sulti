import type { InitializeParams } from "./generated/InitializeParams.js";
import type { InitializeResponse } from "./generated/InitializeResponse.js";
import type { ServerNotification } from "./generated/ServerNotification.js";
import type { ServerRequest } from "./generated/ServerRequest.js";
import type * as V2 from "./generated/v2/index.js";

/**
 * The only client->server methods Sulti ever sends. Anything else is refused
 * by the client before it reaches the wire. In particular the unsandboxed
 * methods (thread/shellCommand, command/exec*, process/*) are not here and
 * must never be added: phone-triggered code must not be able to run commands.
 */
export interface RequestMap {
  initialize: [InitializeParams, InitializeResponse];
  "thread/start": [V2.ThreadStartParams, V2.ThreadStartResponse];
  "thread/resume": [V2.ThreadResumeParams, V2.ThreadResumeResponse];
  "thread/fork": [V2.ThreadForkParams, V2.ThreadForkResponse];
  "thread/list": [V2.ThreadListParams, V2.ThreadListResponse];
  "thread/read": [V2.ThreadReadParams, V2.ThreadReadResponse];
  "turn/start": [V2.TurnStartParams, V2.TurnStartResponse];
  "turn/interrupt": [V2.TurnInterruptParams, V2.TurnInterruptResponse];
  "skills/list": [V2.SkillsListParams, V2.SkillsListResponse];
  "thread/goal/set": [V2.ThreadGoalSetParams, V2.ThreadGoalSetResponse];
  "thread/goal/get": [V2.ThreadGoalGetParams, V2.ThreadGoalGetResponse];
  "thread/goal/clear": [V2.ThreadGoalClearParams, V2.ThreadGoalClearResponse];
  "model/list": [V2.ModelListParams, V2.ModelListResponse];
  "windowsSandbox/readiness": [undefined, V2.WindowsSandboxReadinessResponse];
}
export type RequestMethod = keyof RequestMap;
export type ParamsOf<M extends RequestMethod> = RequestMap[M][0];
export type ResultOf<M extends RequestMethod> = RequestMap[M][1];

export const ALLOWED_METHODS: ReadonlySet<string> = new Set<RequestMethod>([
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/list",
  "thread/read",
  "turn/start",
  "turn/interrupt",
  "skills/list",
  "thread/goal/set",
  "thread/goal/get",
  "thread/goal/clear",
  "model/list",
  "windowsSandbox/readiness",
]);

/** Methods that run outside the thread sandbox. Checked explicitly as a second guard. */
export function isUnsandboxedMethod(method: string): boolean {
  return method === "thread/shellCommand" || method.startsWith("command/exec") || method.startsWith("process/");
}

export type NotificationMethod = ServerNotification["method"];
export type NotificationParams<M extends NotificationMethod> = Extract<ServerNotification, { method: M }>["params"];
export type ServerRequestMethod = ServerRequest["method"];
export type ServerRequestParams<M extends ServerRequestMethod> = Extract<ServerRequest, { method: M }>["params"];
export type { ServerNotification, ServerRequest };
