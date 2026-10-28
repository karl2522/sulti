export interface StopBody {
  event: string;
  cwd: string;
  sessionId: string | null;
  turnId: string | null;
  lastAssistantMessage: string | null;
}
export function dataDir(env?: Record<string, string | undefined>): string;
export function extractStop(payload: unknown): StopBody | null;
export function parseInput(stdinText: string, argv: string[]): unknown;
export function main(argv?: string[], env?: Record<string, string | undefined>): Promise<void>;
