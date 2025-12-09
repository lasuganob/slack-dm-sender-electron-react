"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const web_api_1 = require("@slack/web-api");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let mainWindow = null;
let cachedUsers = [];
let logFilePath;
let syncInFlight = null;
const SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
// ---------- App root & config ----------
function getAppRoot() {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && portableDir.length > 0) {
        return portableDir;
    }
    if (electron_1.app.isPackaged) {
        return node_path_1.default.dirname(electron_1.app.getPath("exe"));
    }
    return process.cwd();
}
const appRoot = getAppRoot();
const configPath = node_path_1.default.join(appRoot, "config.json");
function loadConfig() {
    try {
        const raw = node_fs_1.default.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed.slackBotToken) {
            throw new Error("slackBotToken missing in config.json");
        }
        return {
            slackBotToken: parsed.slackBotToken,
            sendOnlyToWfhIspUsers: parsed.sendOnlyToWfhIspUsers,
            exceptionUserIds: parsed.exceptionUserIds,
        };
    }
    catch (err) {
        const fromEnv = process.env.SLACK_BOT_TOKEN;
        const onlySendToWfhIspUsers = process.env.ONLY_SEND_TO_WFH_ISP === "true";
        const exceptionUserIdsEnv = process.env.EXCEPTION_USER_IDS;
        const exceptionUserIds = exceptionUserIdsEnv
            ? exceptionUserIdsEnv.split(",").map((id) => id.trim())
            : [];
        if (!fromEnv) {
            throw new Error(`Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ""}`);
        }
        return {
            slackBotToken: fromEnv,
            sendOnlyToWfhIspUsers: onlySendToWfhIspUsers,
            exceptionUserIds: exceptionUserIds,
        };
    }
}
const config = loadConfig();
const slack = new web_api_1.WebClient(config.slackBotToken, {
    retryConfig: { retries: 0 },
    logLevel: web_api_1.LogLevel.WARN,
});
// ---------- CSV Readers helpers ----------
function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === "," && !inQuotes) {
            values.push(current);
            current = "";
        }
        else {
            current += ch;
        }
    }
    values.push(current);
    return values;
}
function loadExistingGlatsNames(csvPath) {
    const map = new Map();
    if (!node_fs_1.default.existsSync(csvPath))
        return map;
    const raw = node_fs_1.default.readFileSync(csvPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2)
        return map;
    const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idIdx = headerCols.indexOf("id");
    const glatsIdx = headerCols.indexOf("glats_name");
    if (idIdx === -1 || glatsIdx === -1)
        return map;
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const id = cols[idIdx]?.trim();
        const glats = cols[glatsIdx]?.trim();
        if (id) {
            map.set(id, glats ?? "");
        }
    }
    return map;
}
function loadUsersFromCsv(csvPath) {
    if (!node_fs_1.default.existsSync(csvPath))
        return [];
    const raw = node_fs_1.default.readFileSync(csvPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2)
        return [];
    const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idIdx = headerCols.indexOf("id");
    const slackNameIdx = headerCols.indexOf("slack_name");
    const emailIdx = headerCols.indexOf("email");
    const glatsIdx = headerCols.indexOf("glats_name");
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (!cols.length)
            continue;
        const id = cols[idIdx]?.trim();
        if (!id)
            continue;
        result.push({
            id,
            username: "",
            slackName: cols[slackNameIdx] ?? "",
            email: cols[emailIdx] || undefined,
            glatsName: cols[glatsIdx] || "",
        });
    }
    return result;
}
// ---------- Logging helpers ----------
function ensureLogFile() {
    logFilePath = node_path_1.default.join(appRoot, "slack_dm_sender.log");
    if (!node_fs_1.default.existsSync(logFilePath)) {
        node_fs_1.default.writeFileSync(logFilePath, "", "utf-8");
    }
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
// ---------- Slack + CSV helpers ----------
async function fetchUsersFromSlack() {
    const users = [];
    let cursor;
    const sendOnlyToWfhIspUsers = config.sendOnlyToWfhIspUsers || false;
    do {
        const res = await slack.users.list({ cursor, limit: 200 });
        if (res.members) {
            for (const m of res.members) {
                if (!m || m.deleted || m.is_bot || m.id === "USLACKBOT")
                    continue;
                const profile = m.profile ?? {};
                const displayName = profile.display_name || "";
                const slackName = profile.display_name || profile.real_name || "";
                const displayNameLower = displayName.toLowerCase();
                const hasWfhOrIsp = /\bWFH\b/i.test(displayNameLower) ||
                    /\bISP\b/i.test(displayNameLower);
                // @TODO: Delete after testing
                const exceptionIds = config.exceptionUserIds || [];
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
function usersToCsv(users) {
    const header = "id,slack_name,email,glats_name";
    const rows = users.map((u) => [u.id, u.slackName, u.email ?? "", u.glatsName ?? ""]
        .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
        .join(","));
    return [header, ...rows].join("\n");
}
async function syncUsersCore() {
    logEvent("INFO", "sync_users_started");
    const csvPath = node_path_1.default.join(appRoot, "slack_users.csv");
    const existingGlats = loadExistingGlatsNames(csvPath);
    const fetched = await fetchUsersFromSlack();
    const merged = fetched.map((u) => ({
        ...u,
        glatsName: existingGlats.get(u.id) ?? "",
    }));
    cachedUsers = merged;
    const csv = usersToCsv(merged);
    node_fs_1.default.writeFileSync(csvPath, csv, "utf-8");
    logEvent("INFO", "sync_users_success", {
        count: cachedUsers.length,
        csvPath,
    });
    if (mainWindow) {
        mainWindow.webContents.send("users-updated", {
            users: cachedUsers,
            csvPath,
        });
    }
    return { users: cachedUsers, csvPath };
}
async function syncUsersThrottled() {
    const csvPath = node_path_1.default.join(appRoot, "slack_users.csv");
    const now = Date.now();
    if (syncInFlight) {
        return syncInFlight;
    }
    const csvExists = node_fs_1.default.existsSync(csvPath);
    const csvMtime = csvExists ? node_fs_1.default.statSync(csvPath).mtimeMs : null;
    const csvAge = csvMtime ? now - csvMtime : null;
    if (csvExists && csvAge !== null && csvAge < SYNC_MIN_INTERVAL_MS) {
        const fromCsv = loadUsersFromCsv(csvPath);
        const existingGlats = loadExistingGlatsNames(csvPath);
        cachedUsers = fromCsv.map((u) => ({
            ...u,
            glatsName: existingGlats.get(u.id) ?? u.glatsName ?? "",
        }));
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
// ---------- Window & lifecycle ----------
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 600,
        height: 620,
        resizable: false,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
        },
    });
    if (electron_1.app.isPackaged) {
        const indexPath = node_path_1.default.join(__dirname, "../dist/index.html");
        mainWindow.loadFile(indexPath);
    }
    else {
        mainWindow.loadURL("http://localhost:5173");
        mainWindow.webContents.openDevTools();
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(async () => {
    ensureLogFile();
    logEvent("INFO", "app_started", { appRoot });
    createWindow();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ---------- IPC handlers ----------
electron_1.ipcMain.handle("get-users", async () => {
    return cachedUsers;
});
electron_1.ipcMain.handle("sync-users", async () => {
    try {
        const { users, csvPath } = await syncUsersThrottled();
        return {
            ok: true,
            users,
            csvPath,
            logPath: logFilePath,
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
        const csvPath = node_path_1.default.join(appRoot, "slack_users.csv");
        if (isRateLimited && node_fs_1.default.existsSync(csvPath)) {
            const fromCsv = loadUsersFromCsv(csvPath);
            const existingGlats = loadExistingGlatsNames(csvPath);
            cachedUsers = fromCsv.map((u) => ({
                ...u,
                glatsName: existingGlats.get(u.id) ?? u.glatsName ?? "",
            }));
            logEvent("INFO", "sync_users_rate_limited_using_cache", {
                csvPath,
                count: cachedUsers.length,
                retryAfter: retryAfterSeconds,
            });
            return {
                ok: false,
                error: msg,
                logPath: logFilePath,
                rateLimited: true,
                retryAfter: retryAfterSeconds,
            };
        }
        logEvent("ERROR", "sync_users_failed", {
            error: msg,
            statusCode,
            retryAfter: retryAfterSeconds,
        });
        return {
            ok: false,
            error: msg,
            logPath: logFilePath,
            rateLimited: isRateLimited,
            retryAfter: retryAfterSeconds,
        };
    }
});
electron_1.ipcMain.handle("choose-attachments-dir", async () => {
    const result = await electron_1.dialog.showOpenDialog({
        title: "Select folder with attachment PDFs",
        properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
        return null;
    }
    return result.filePaths[0];
});
electron_1.ipcMain.handle("send-dms", async (event, args) => {
    const { userIds, text, attachmentsDir } = args;
    logEvent("INFO", "send_dms_handler_invoked", {
        userCount: userIds.length,
        attachmentsDir,
    });
    const failedUsers = [];
    let sentCount = 0;
    try {
        for (const userId of userIds) {
            const user = cachedUsers.find((u) => u.id === userId);
            if (!user) {
                const msg = "User not found in cache (sync may be stale).";
                logEvent("ERROR", "send_dm_failed", { userId, error: msg });
                failedUsers.push({ userId, error: msg });
                continue;
            }
            let filePath = null;
            if (attachmentsDir) {
                const expected = node_path_1.default.join(attachmentsDir, `${user.glatsName}.pdf`);
                if (node_fs_1.default.existsSync(expected)) {
                    filePath = expected;
                }
                else {
                    const msg = `Attachment not found: ${expected}`;
                    logEvent("ERROR", "attachment_missing", { userId, expected });
                    failedUsers.push({ userId, error: msg });
                    continue;
                }
            }
            try {
                const conv = await slack.conversations.open({ users: userId });
                const channelId = conv.channel?.id;
                if (!channelId) {
                    throw new Error("No channel id returned by Slack.");
                }
                const greetingText = `Hello ${user.glatsName || user.slackName},\n\n`;
                const fullText = greetingText + text;
                if (filePath) {
                    await slack.files.uploadV2({
                        channels: channelId,
                        file: node_fs_1.default.createReadStream(filePath),
                        filename: node_path_1.default.basename(filePath),
                        initial_comment: fullText || undefined,
                    });
                }
                else {
                    await slack.chat.postMessage({ channel: channelId, text: fullText });
                }
                sentCount += 1;
                logEvent("INFO", "send_dm_success", {
                    userId,
                    filePath: filePath ?? null,
                });
            }
            catch (err) {
                let msg = "Unknown error sending DM.";
                if (err instanceof Error) {
                    msg = err.message;
                }
                else if (typeof err === "string") {
                    msg = err;
                }
                else if (err &&
                    typeof err === "object" &&
                    "message" in err &&
                    typeof err.message === "string") {
                    msg = err.message;
                }
                logEvent("ERROR", "send_dm_failed", { userId, error: msg });
                failedUsers.push({ userId, error: msg });
            }
        }
        const ok = failedUsers.length === 0;
        logEvent("INFO", "send_dms_finished", {
            ok,
            sent: sentCount,
            failed: failedUsers.length,
        });
        return {
            ok,
            sent: sentCount,
            failed: failedUsers.length,
            failedUsers,
        };
    }
    catch (err) {
        let msg = "send_dms handler crashed unexpectedly.";
        if (err instanceof Error) {
            msg = err.message;
        }
        else if (typeof err === "string") {
            msg = err;
        }
        else if (err &&
            typeof err === "object" &&
            "message" in err &&
            typeof err.message === "string") {
            msg = err.message;
        }
        logEvent("ERROR", "send_dms_handler_crashed", { error: msg });
        return {
            ok: false,
            sent: sentCount,
            failed: userIds.length,
            failedUsers: failedUsers.length > 0
                ? failedUsers
                : userIds.map((id) => ({ userId: id, error: msg })),
        };
    }
});
electron_1.ipcMain.handle("get-log-path", async () => {
    return logFilePath;
});
electron_1.ipcMain.handle("open-csv", async () => {
    const csvPath = node_path_1.default.join(appRoot, "slack_users.csv");
    if (!node_fs_1.default.existsSync(csvPath)) {
        const msg = `slack_users.csv not found at ${csvPath}`;
        logEvent("ERROR", "open_csv_not_found", { csvPath });
        throw new Error(msg);
    }
    const result = await electron_1.shell.openPath(csvPath);
    if (result) {
        logEvent("ERROR", "open_csv_failed", { csvPath, error: result });
        throw new Error(`Failed to open CSV: ${result}`);
    }
    logEvent("INFO", "open_csv_success", { csvPath });
    return true;
});
//# sourceMappingURL=main.js.map