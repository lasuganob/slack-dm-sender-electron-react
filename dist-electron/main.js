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
let lastSyncAt = null;
let syncInFlight = null;
const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
// ---------- App root & config ----------
function getAppRoot() {
    if (electron_1.app.isPackaged) {
        return node_path_1.default.dirname(electron_1.app.getPath('exe'));
    }
    return process.cwd();
}
const appRoot = getAppRoot();
const configPath = node_path_1.default.join(appRoot, 'config.json');
function loadConfig() {
    try {
        const raw = node_fs_1.default.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.slackBotToken) {
            throw new Error('slackBotToken missing in config.json');
        }
        return { slackBotToken: parsed.slackBotToken };
    }
    catch (err) {
        const fromEnv = process.env.SLACK_BOT_TOKEN;
        if (!fromEnv) {
            throw new Error(`Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ''}`);
        }
        return { slackBotToken: fromEnv };
    }
}
const config = loadConfig();
const slack = new web_api_1.WebClient(config.slackBotToken, {
    retryConfig: { retries: 0 },
    logLevel: web_api_1.LogLevel.WARN,
});
// ---------- Logging helpers ----------
function ensureLogFile() {
    logFilePath = node_path_1.default.join(appRoot, 'slack_dm_sender.log');
    if (!node_fs_1.default.existsSync(logFilePath)) {
        node_fs_1.default.writeFileSync(logFilePath, '', 'utf-8');
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
    node_fs_1.default.appendFile(logFilePath, JSON.stringify(entry) + '\n', () => {
        // ignore write error
    });
}
// ---------- Slack + CSV helpers ----------
async function fetchUsersFromSlack() {
    const users = [];
    let cursor;
    do {
        const res = await slack.users.list({ cursor, limit: 200 });
        if (res.members) {
            for (const m of res.members) {
                if (!m || m.deleted || m.is_bot || m.id === 'USLACKBOT')
                    continue;
                const profile = m.profile ?? {};
                users.push({
                    id: m.id,
                    name: m.name ?? '',
                    realName: profile.real_name ?? '',
                    displayName: profile.display_name ?? '',
                    email: profile.email ?? undefined,
                });
            }
        }
        cursor = typeof res.response_metadata?.next_cursor === 'string'
            ? res.response_metadata.next_cursor
            : undefined;
    } while (cursor);
    return users;
}
function usersToCsv(users) {
    const header = 'id,name,real_name,display_name,email';
    const rows = users.map((u) => [
        u.id,
        u.name,
        u.realName,
        u.displayName,
        u.email ?? '',
    ]
        .map((v) => `"${(v ?? '').replace(/"/g, '""')}"`)
        .join(','));
    return [header, ...rows].join('\n');
}
async function syncUsersCore() {
    logEvent('INFO', 'sync_users_started');
    const rawUsers = await fetchUsersFromSlack();
    const map = new Map();
    for (const u of rawUsers) {
        map.set(u.id, u);
    }
    cachedUsers = Array.from(map.values());
    const csv = usersToCsv(cachedUsers);
    const csvPath = node_path_1.default.join(appRoot, 'slack_users.csv');
    node_fs_1.default.writeFileSync(csvPath, csv, 'utf-8');
    logEvent('INFO', 'sync_users_success', {
        count: cachedUsers.length,
        csvPath,
    });
    if (mainWindow) {
        mainWindow.webContents.send('users-updated', {
            users: cachedUsers,
            csvPath,
        });
    }
    return { users: cachedUsers, csvPath };
}
async function syncUsersThrottled() {
    const csvPath = node_path_1.default.join(appRoot, 'slack_users.csv');
    const now = Date.now();
    if (syncInFlight) {
        return syncInFlight;
    }
    if (lastSyncAt &&
        now - lastSyncAt < SYNC_MIN_INTERVAL_MS &&
        cachedUsers.length) {
        return { users: cachedUsers, csvPath };
    }
    syncInFlight = (async () => {
        const result = await syncUsersCore();
        lastSyncAt = Date.now();
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
        height: 500,
        resizable: false,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
        },
    });
    if (electron_1.app.isPackaged) {
        const indexPath = node_path_1.default.join(__dirname, '../dist/index.html');
        mainWindow.loadFile(indexPath);
    }
    else {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(async () => {
    ensureLogFile();
    logEvent('INFO', 'app_started', { appRoot });
    createWindow();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ---------- IPC handlers ----------
electron_1.ipcMain.handle('get-users', async () => {
    return cachedUsers;
});
electron_1.ipcMain.handle('sync-users', async () => {
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
        let msg = 'Failed to sync users from Slack.';
        let slackError = undefined;
        let statusCode = undefined;
        let retryAfterSeconds = null;
        let isRateLimited = false;
        if (err && typeof err === 'object') {
            const e = err;
            msg = typeof e.message === 'string' ? e.message : msg;
            slackError = typeof e.data === 'object' && e.data && typeof e.data.error === 'string' ? e.data.error : undefined;
            statusCode = typeof e.statusCode === 'string' || typeof e.statusCode === 'number' ? e.statusCode : (typeof e.code === 'string' ? e.code : undefined);
            const retryAfterHeader = typeof e.retryAfter === 'number' ? e.retryAfter : (e.data && typeof e.data.retry_after === 'number' ? e.data.retry_after : (e.headers && typeof e.headers['retry-after'] === 'number' ? e.headers['retry-after'] : null));
            retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
            isRateLimited = slackError === 'ratelimited' || statusCode === 429;
        }
        logEvent('ERROR', 'sync_users_failed', {
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
electron_1.ipcMain.handle('send-dms', async (event, args) => {
    const { userIds, text } = args;
    logEvent('INFO', 'send_dms_handler_invoked', {
        userCount: userIds.length,
    });
    const failedUsers = [];
    let sentCount = 0;
    try {
        for (const userId of userIds) {
            try {
                const conv = await slack.conversations.open({ users: userId });
                const channelId = conv.channel?.id;
                if (!channelId) {
                    throw new Error('No channel id returned by Slack.');
                }
                await slack.chat.postMessage({ channel: channelId, text });
                sentCount += 1;
                logEvent('INFO', 'send_dm_success', { userId });
                console.log('[main] send_dm_success', userId);
            }
            catch (err) {
                let msg = 'Unknown error sending DM.';
                if (err instanceof Error) {
                    msg = err.message;
                }
                else if (typeof err === 'string') {
                    msg = err;
                }
                else if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
                    msg = err.message;
                }
                logEvent('ERROR', 'send_dm_failed', { userId, error: msg });
                console.error('[main] send_dm_failed', userId, msg);
                failedUsers.push({ userId, error: msg });
            }
        }
        const ok = failedUsers.length === 0;
        logEvent('INFO', 'send_dms_finished', {
            ok,
            sent: sentCount,
            failed: failedUsers.length,
        });
        console.log('[main] send_dms_finished', {
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
        let msg = 'send_dms handler crashed unexpectedly.';
        if (err instanceof Error) {
            msg = err.message;
        }
        else if (typeof err === 'string') {
            msg = err;
        }
        else if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
            msg = err.message;
        }
        logEvent('ERROR', 'send_dms_handler_crashed', { error: msg });
        console.error('[main] send_dms_handler_crashed', msg);
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
electron_1.ipcMain.handle('get-log-path', async () => {
    return logFilePath;
});
//# sourceMappingURL=main.js.map