import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Surreal, createRemoteEngines } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";

const MEMPORT_NAMESPACE = "memport";

let rootConnection: Surreal | undefined;

export async function getRootConnection(dataDir: string): Promise<Surreal> {
  if (rootConnection) {
    return rootConnection;
  }

  await mkdir(dataDir, { recursive: true });

  const db = new Surreal({
    engines: {
      ...createRemoteEngines(),
      ...createNodeEngines(),
    },
  });

  const storagePath = path.join(dataDir, "memport.db");
  await db.connect(`surrealkv://${storagePath}`, {
    namespace: MEMPORT_NAMESPACE,
  });

  rootConnection = db;
  return db;
}

export async function closeRootConnection(): Promise<void> {
  if (rootConnection) {
    await rootConnection.close();
    rootConnection = undefined;
  }
}
