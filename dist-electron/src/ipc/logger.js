"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureLogFile = ensureLogFile;
exports.getLogFilePath = getLogFilePath;
exports.logEvent = logEvent;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const app_root_1 = require("../app-root");
let logFilePath;
function ensureLogFile() {
    logFilePath = node_path_1.default.join(app_root_1.appRoot, "slack_dm_sender.log");
    if (!node_fs_1.default.existsSync(logFilePath)) {
        node_fs_1.default.writeFileSync(logFilePath, "", "utf-8");
    }
}
function getLogFilePath() {
    return logFilePath;
}
function logEvent(level, message, data) {
    if (!logFilePath)
        return;
    const entry = {
        time: new Date().toISOString(),
        level,
        message,
        ...(data ? { data } : {}),
    };
    node_fs_1.default.appendFile(logFilePath, JSON.stringify(entry) + "\n", () => {
        // ignore write error
    });
}
//# sourceMappingURL=logger.js.map