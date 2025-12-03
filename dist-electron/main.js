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
const slack = new web_api_1.WebClient(process.env.SLACK_BOT_TOKEN);
// ---------- Logging helpers ----------
function ensureLogFile() {
    const userDataDir = electron_1.app.getPath('userData');
    logFilePath = node_path_1.default.join(userDataDir, 'slack_dm_sender.log');
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
        // ignore write errors
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
        const meta = res.response_metadata;
        cursor = meta?.next_cursor ? meta.next_cursor : undefined;
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
async function syncUsers() {
    logEvent('INFO', 'sync_users_started');
    try {
        const rawUsers = await fetchUsersFromSlack();
        const map = new Map();
        for (const u of rawUsers) {
            map.set(u.id, u);
        }
        cachedUsers = Array.from(map.values());
        const csv = usersToCsv(cachedUsers);
        const userDataDir = electron_1.app.getPath('userData');
        const csvPath = node_path_1.default.join(userDataDir, 'slack_users.csv');
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
    catch (err) {
        logEvent('ERROR', 'sync_users_failed', {
            error: err?.message ?? String(err),
        });
        throw err;
    }
}
// ---------- Window & app lifecycle ----------
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 600,
        height: 600,
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
    logEvent('INFO', 'app_started');
    createWindow();
    try {
        await syncUsers();
    }
    catch {
        // Already logged; renderer will get errors via IPC when it tries to sync
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ---------- IPC handlers ----------
electron_1.ipcMain.handle('get-users', async () => {
    if (!cachedUsers.length) {
        await syncUsers();
    }
    return cachedUsers;
});
electron_1.ipcMain.handle('sync-users', async () => {
    try {
        const { users, csvPath } = await syncUsers();
        return { ok: true, users, csvPath, logPath: logFilePath };
    }
    catch (err) {
        return {
            ok: false,
            error: err?.message ?? 'Failed to sync users from Slack.',
            logPath: logFilePath,
        };
    }
});
electron_1.ipcMain.handle('send-dms', async (event, args) => {
    const { userIds, text } = args;
    logEvent('INFO', 'send_dms_handler_invoked', {
        userCount: userIds.length,
    });
    console.log('[main] send-dms invoked', { userIdsCount: userIds.length });
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
                const msg = err?.message ?? 'Unknown error sending DM.';
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
        const msg = err?.message ?? 'send_dms handler crashed unexpectedly.';
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