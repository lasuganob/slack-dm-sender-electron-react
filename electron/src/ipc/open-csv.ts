import path from "node:path";
import fs from "node:fs";
import { shell } from "electron";

import { appRoot } from "../app-root";
import { logEvent } from "./logger";

export async function openCsv(): Promise<boolean> {
  const csvPath = path.join(appRoot, "slack_users.csv");

  if (!fs.existsSync(csvPath)) {
    const msg = `slack_users.csv not found at ${csvPath}`;
    logEvent("ERROR", "open_csv_not_found", { csvPath });
    throw new Error(msg);
  }

  const result = await shell.openPath(csvPath);
  if (result) {
    logEvent("ERROR", "open_csv_failed", { csvPath, error: result });
    throw new Error(`Failed to open CSV: ${result}`);
  }

  logEvent("INFO", "open_csv_success", { csvPath });
  return true;
}
