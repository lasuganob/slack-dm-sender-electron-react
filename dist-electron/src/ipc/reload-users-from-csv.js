"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reloadUsersFromCsv = reloadUsersFromCsv;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const app_root_1 = require("../app-root");
const logger_1 = require("./logger");
const slack_users_1 = require("./slack-users");
function reloadUsersFromCsv() {
    const csvPath = node_path_1.default.join(app_root_1.appRoot, "slack_users.csv");
    if (!node_fs_1.default.existsSync(csvPath)) {
        const error = `slack_users.csv not found at ${csvPath}`;
        (0, logger_1.logEvent)("ERROR", "reload_csv_not_found", { csvPath });
        return {
            ok: false,
            error,
            csvPath,
            logPath: (0, logger_1.getLogFilePath)(),
        };
    }
    // Your helper that reads CSV and updates cachedUsers
    (0, slack_users_1.hydrateCachedUsersFromCsv)(csvPath);
    const users = (0, slack_users_1.getCachedUsers)();
    (0, logger_1.logEvent)("INFO", "reload_csv_success", {
        count: users.length,
        csvPath,
    });
    return {
        ok: true,
        users,
        csvPath,
        logPath: (0, logger_1.getLogFilePath)(),
    };
}
//# sourceMappingURL=reload-users-from-csv.js.map