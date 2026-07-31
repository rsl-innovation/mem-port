import os from "node:os";
import path from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  embeddingModel: string;
}

function defaultDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "mem-port");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "mem-port");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "mem-port");
}

export function resolveConfig(overrides: Partial<Config> = {}): Config {
  const port = overrides.port ?? (process.env.MEM_PORT_PORT ? Number(process.env.MEM_PORT_PORT) : 8787);
  const dataDir = overrides.dataDir ?? process.env.MEM_PORT_DATA_DIR ?? defaultDataDir();
  const embeddingModel =
    overrides.embeddingModel ?? process.env.MEM_PORT_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";
  return { port, dataDir, embeddingModel };
}
