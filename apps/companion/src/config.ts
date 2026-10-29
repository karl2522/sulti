import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { APP_SLUG, DEFAULT_HOOK_PORT, DEFAULT_PHONE_PORT, SHARED_APP_SERVER_PORT } from "@sulti/core";
import { readJsonText } from "./store.js";

export const ConfigFile = z.object({
  /** Public HTTPS origin the phone uses, e.g. the Tailscale Serve URL. */
  publicUrl: z.string().url().optional(),
  port: z.number().int().min(0).max(65535).optional(),
  hookPort: z.number().int().min(0).max(65535).optional(),
  /** "stdio": spawn codex app-server. "shared": connect to a shared ws app-server. */
  mode: z.enum(["stdio", "shared"]).optional(),
  sharedUrl: z.string().optional(),
  sharedTokenFile: z.string().optional(),
  /** Override the app-server command (tests use the mock). */
  appServerCommand: z.array(z.string()).min(1).optional(),
  dev: z.boolean().optional(),
  tts: z.object({ voice: z.string().optional(), rate: z.number().int().min(-10).max(10).optional() }).optional(),
});
export type ConfigFile = z.infer<typeof ConfigFile>;

export interface Config {
  dataDir: string;
  publicUrl: string | null;
  port: number;
  hookPort: number;
  mode: "stdio" | "shared";
  sharedUrl: string;
  sharedTokenFile: string;
  appServerCommand: string[] | null;
  dev: boolean;
  tts: { voice?: string; rate?: number };
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SULTI_DATA_DIR) return env.SULTI_DATA_DIR;
  if (env.APPDATA) return join(env.APPDATA, APP_SLUG);
  return join(homedir(), "." + APP_SLUG);
}

function envPort(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined;
}

/** Load config.json from the data dir, then apply SULTI_* environment overrides. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? defaultDataDir(env);
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "config.json");
  let parsed: ConfigFile = {};
  if (existsSync(file)) {
    const raw = readJsonText(file);
    const res = ConfigFile.safeParse(raw);
    if (!res.success) throw new Error(`Invalid config.json: ${res.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
    parsed = res.data;
  }
  let appServerCommand: string[] | null = parsed.appServerCommand ?? null;
  if (env.SULTI_APP_SERVER_CMD) appServerCommand = JSON.parse(env.SULTI_APP_SERVER_CMD) as string[];
  const cfg: Config = {
    dataDir,
    publicUrl: (env.SULTI_PUBLIC_URL || parsed.publicUrl || null)?.replace(/\/+$/, "") ?? null,
    port: envPort(env.SULTI_PORT) ?? parsed.port ?? DEFAULT_PHONE_PORT,
    hookPort: envPort(env.SULTI_HOOK_PORT) ?? parsed.hookPort ?? DEFAULT_HOOK_PORT,
    mode: (env.SULTI_MODE as Config["mode"]) || parsed.mode || "stdio",
    sharedUrl: parsed.sharedUrl ?? `ws://127.0.0.1:${SHARED_APP_SERVER_PORT}`,
    sharedTokenFile: parsed.sharedTokenFile ?? join(dataDir, "app-server-token"),
    appServerCommand,
    dev: env.SULTI_DEV === "1" || parsed.dev === true,
    tts: parsed.tts ?? {},
  };
  return { ...cfg, ...overrides };
}
