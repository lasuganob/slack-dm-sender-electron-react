"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setUsersUpdatedHandler = setUsersUpdatedHandler;
exports.getCachedUsers = getCachedUsers;
exports.syncUsersCore = syncUsersCore;
exports.hydrateCachedUsersFromCsv = hydrateCachedUsersFromCsv;
exports.syncUsersThrottled = syncUsersThrottled;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const app_root_1 = require("../app-root");
const config_1 = require("../config");
const csv_helper_1 = require("../csv-helper");
const slack_client_1 = require("../slack-client");
const logger_1 = require("./logger");
const SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
let cachedUsers = [];
let syncInFlight = null;
let usersUpdatedHandler = null;
function setUsersUpdatedHandler(handler) {
    usersUpdatedHandler = handler;
}
function getCachedUsers() {
    return cachedUsers;
}
async function fetchUsersFromSlack() {
    const users = [];
    let cursor;
    const sendOnlyToWfhIspUsers = config_1.config.sendOnlyToWfhIspUsers || false;
    do {
        const res = await slack_client_1.slack.users.list({ cursor, limit: 200 });
        if (res.members) {
            for (const m of res.members) {
                if (!m || m.deleted || m.is_bot || m.id === "USLACKBOT")
                    continue;
                const profile = m.profile ?? {};
                const slackName = profile.display_name || profile.real_name || m.name || "";
                const slackNameLower = slackName.toLowerCase();
                const hasWfhOrIsp = /\bWFH\b/i.test(slackNameLower) || /\bISP\b/i.test(slackNameLower);
                const exceptionIds = config_1.config.exceptionUserIds || [];
                if (!hasWfhOrIsp &&
                    sendOnlyToWfhIspUsers &&
                    !exceptionIds.includes(m.id)) {
                    continue;
                }
                users.push({
                    id: m.id,
                    username: m.name ?? "",
                    slackName,
                    email: profile.email ?? undefined,
                    glatsName: undefined,
                });
            }
        }
        cursor =
            typeof res.response_metadata?.next_cursor === "string"
                ? res.response_metadata.next_cursor
                : undefined;
    } while (cursor);
    return users;
}
async function syncUsersCore() {
    (0, logger_1.logEvent)("INFO", "sync_users_started");
    const csvPath = node_path_1.default.join(app_root_1.appRoot, "slack_users.csv");
    const existingGlats = (0, csv_helper_1.loadExistingGlatsNames)(csvPath);
    const fetched = await fetchUsersFromSlack();
    const merged = fetched.map((u) => ({
        ...u,
        glatsName: existingGlats.get(u.id) ?? "",
    }));
    cachedUsers = merged;
    const csv = (0, csv_helper_1.usersToCsv)(merged);
    node_fs_1.default.writeFileSync(csvPath, csv, "utf-8");
    (0, logger_1.logEvent)("INFO", "sync_users_success", {
        count: cachedUsers.length,
        csvPath,
    });
    if (usersUpdatedHandler) {
        usersUpdatedHandler({
            users: cachedUsers,
            csvPath,
        });
    }
    return { users: cachedUsers, csvPath };
}
function hydrateCachedUsersFromCsv(csvPath) {
    const fromCsv = (0, csv_helper_1.loadUsersFromCsv)(csvPath);
    const existingGlats = (0, csv_helper_1.loadExistingGlatsNames)(csvPath);
    cachedUsers = fromCsv.map((u) => ({
        ...u,
        glatsName: existingGlats.get(u.id) ?? u.glatsName ?? "",
    }));
}
async function syncUsersThrottled() {
    const csvPath = node_path_1.default.join(app_root_1.appRoot, "slack_users.csv");
    const now = Date.now();
    if (syncInFlight) {
        return syncInFlight;
    }
    const csvExists = node_fs_1.default.existsSync(csvPath);
    const csvMtime = csvExists ? node_fs_1.default.statSync(csvPath).mtimeMs : null;
    const csvAge = csvMtime ? now - csvMtime : null;
    if (csvExists && csvAge !== null && csvAge < SYNC_MIN_INTERVAL_MS) {
        hydrateCachedUsersFromCsv(csvPath);
        return { users: cachedUsers, csvPath };
    }
    syncInFlight = (async () => {
        const result = await syncUsersCore();
        return result;
    })();
    try {
        const result = await syncInFlight;
        return result;
    }
    finally {
        syncInFlight = null;
    }
}
//# sourceMappingURL=slack-users.js.map