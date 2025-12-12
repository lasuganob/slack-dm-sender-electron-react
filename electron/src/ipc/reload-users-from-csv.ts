import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../app-root";
import { getLogFilePath, logEvent } from "./logger";
import { getCachedUsers, hydrateCachedUsersFromCsv } from "./slack-users";

export function reloadUsersFromCsv() {
    const csvPath = path.join(appRoot, "slack_users.csv");

    if (!fs.existsSync(csvPath)) {
        const error = `slack_users.csv not found at ${csvPath}`;
        logEvent("ERROR", "reload_csv_not_found", { csvPath });
        return {
        ok: false as const,
        error,
        csvPath,
        logPath: getLogFilePath(),
        };
    }

    // Your helper that reads CSV and updates cachedUsers
    hydrateCachedUsersFromCsv(csvPath);
    const users = getCachedUsers();

    logEvent("INFO", "reload_csv_success", {
        count: users.length,
        csvPath,
    });

    return {
        ok: true as const,
        users,
        csvPath,
        logPath: getLogFilePath(),
    };
}
