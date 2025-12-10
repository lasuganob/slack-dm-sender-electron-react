"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSyncUsers = handleSyncUsers;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const app_root_1 = require("../app-root");
const slack_users_1 = require("./slack-users");
const logger_1 = require("./logger");
async function handleSyncUsers() {
    try {
        const { users, csvPath } = await (0, slack_users_1.syncUsersThrottled)();
        return {
            ok: true,
            users,
            csvPath,
            logPath: (0, logger_1.getLogFilePath)(),
            rateLimited: false,
            retryAfter: null,
        };
    }
    catch (err) {
        let msg = "Failed to sync users from Slack.";
        let slackError = undefined;
        let statusCode = undefined;
        let retryAfterSeconds = null;
        let isRateLimited = false;
        if (err && typeof err === "object") {
            const e = err;
            msg = typeof e.message === "string" ? e.message : msg;
            if (typeof e.data === "object" && e.data !== null) {
                const errorVal = e.data.error;
                slackError = typeof errorVal === "string" ? errorVal : undefined;
            }
            statusCode =
                typeof e.statusCode === "string" || typeof e.statusCode === "number"
                    ? e.statusCode
                    : typeof e.code === "string"
                        ? e.code
                        : undefined;
            const retryAfterHeader = typeof e.retryAfter === "number"
                ? e.retryAfter
                : e.data &&
                    typeof e.data.retry_after === "number"
                    ? e.data.retry_after
                    : e.headers &&
                        typeof e.headers["retry-after"] ===
                            "number"
                        ? e.headers["retry-after"]
                        : null;
            retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
            isRateLimited = slackError === "ratelimited" || statusCode === 429;
        }
        const csvPath = node_path_1.default.join(app_root_1.appRoot, "slack_users.csv");
        if (isRateLimited && node_fs_1.default.existsSync(csvPath)) {
            (0, slack_users_1.hydrateCachedUsersFromCsv)(csvPath);
            (0, logger_1.logEvent)("INFO", "sync_users_rate_limited_using_cache", {
                csvPath,
                retryAfter: retryAfterSeconds,
            });
            return {
                ok: false,
                error: msg,
                logPath: (0, logger_1.getLogFilePath)(),
                rateLimited: true,
                retryAfter: retryAfterSeconds,
            };
        }
        (0, logger_1.logEvent)("ERROR", "sync_users_failed", {
            error: msg,
            statusCode,
            retryAfter: retryAfterSeconds,
        });
        return {
            ok: false,
            error: msg,
            logPath: (0, logger_1.getLogFilePath)(),
            rateLimited: isRateLimited,
            retryAfter: retryAfterSeconds,
        };
    }
}
//# sourceMappingURL=sync-users-handler.js.map