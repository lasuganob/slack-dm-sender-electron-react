"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openCsv = openCsv;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const electron_1 = require("electron");
const app_root_1 = require("../app-root");
const logger_1 = require("./logger");
async function openCsv() {
    const csvPath = node_path_1.default.join(app_root_1.appRoot, "slack_users.csv");
    if (!node_fs_1.default.existsSync(csvPath)) {
        const msg = `slack_users.csv not found at ${csvPath}`;
        (0, logger_1.logEvent)("ERROR", "open_csv_not_found", { csvPath });
        throw new Error(msg);
    }
    const result = await electron_1.shell.openPath(csvPath);
    if (result) {
        (0, logger_1.logEvent)("ERROR", "open_csv_failed", { csvPath, error: result });
        throw new Error(`Failed to open CSV: ${result}`);
    }
    (0, logger_1.logEvent)("INFO", "open_csv_success", { csvPath });
    return true;
}
//# sourceMappingURL=open-csv.js.map