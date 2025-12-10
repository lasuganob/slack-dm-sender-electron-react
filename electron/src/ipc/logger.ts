import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../app-root";

let logFilePath: string;

export function ensureLogFile() {
  logFilePath = path.join(appRoot, "slack_dm_sender.log");
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, "", "utf-8");
  }
}

export function getLogFilePath(): string | undefined {
  return logFilePath;
}

export function logEvent(
  level: "INFO" | "ERROR",
  message: string,
  data?: Record<string, unknown>
) {
  if (!logFilePath) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(data ? { data } : {}),
  };
  fs.appendFile(logFilePath, JSON.stringify(entry) + "\n", () => {
    // ignore write error
  });
}
