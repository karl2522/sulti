import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..");
export const MOCK_SERVER = join(REPO_ROOT, "test", "mock-app-server", "server.mjs");
