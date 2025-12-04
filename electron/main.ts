import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { WebClient, LogLevel } from '@slack/web-api';
import dotenv from 'dotenv';

dotenv.config();

type SlackUser = {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  email?: string;
};

type AppConfig = {
  slackBotToken: string;
};

let mainWindow: BrowserWindow | null = null;
let cachedUsers: SlackUser[] = [];
let logFilePath: string;

let lastSyncAt: number | null = null;
let syncInFlight: Promise<{ users: SlackUser[]; csvPath: string }> | null = null;

const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
// ---------- App root & config ----------

function getAppRoot(): string {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return process.cwd();
}

const appRoot = getAppRoot();
const configPath = path.join(appRoot, 'config.json');

function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.slackBotToken) {
      throw new Error('slackBotToken missing in config.json');
    }
    return { slackBotToken: parsed.slackBotToken };
  } catch (err: unknown) {
    const fromEnv = process.env.SLACK_BOT_TOKEN;
    if (!fromEnv) {
      throw new Error(
        `Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ''}`
      );
    }
    return { slackBotToken: fromEnv };
  }
}

const config = loadConfig();
const slack = new WebClient(config.slackBotToken, {
  retryConfig: { retries: 0 },
  logLevel: LogLevel.WARN,
});

// ---------- Logging helpers ----------
function ensureLogFile() {
  logFilePath = path.join(appRoot, 'slack_dm_sender.log');
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '', 'utf-8');
  }
}

function logEvent(
  level: 'INFO' | 'ERROR',
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
  fs.appendFile(
    logFilePath,
    JSON.stringify(entry) + '\n',
    () => {
      // ignore write error
    }
  );
}

// ---------- Slack + CSV helpers ----------
async function fetchUsersFromSlack(): Promise<SlackUser[]> {
  const users: SlackUser[] = [];
  let cursor: string | undefined;

  do {
    const res = await slack.users.list({ cursor, limit: 200 });

    if (res.members) {
      for (const m of res.members) {
        if (!m || m.deleted || m.is_bot || m.id === 'USLACKBOT') continue;

        const profile = m.profile ?? {};
        users.push({
          id: m.id!,
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

function usersToCsv(users: SlackUser[]): string {
  const header = 'id,name,real_name,display_name,email';
  const rows = users.map((u) =>
    [
      u.id,
      u.name,
      u.realName,
      u.displayName,
      u.email ?? '',
    ]
      .map((v) => `"${(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header, ...rows].join('\n');
}

async function syncUsersCore(): Promise<{ users: SlackUser[]; csvPath: string }> {
  logEvent('INFO', 'sync_users_started');
  const rawUsers = await fetchUsersFromSlack();

  const map = new Map<string, SlackUser>();
  for (const u of rawUsers) {
    map.set(u.id, u);
  }
  cachedUsers = Array.from(map.values());

  const csv = usersToCsv(cachedUsers);
  const csvPath = path.join(appRoot, 'slack_users.csv');
  fs.writeFileSync(csvPath, csv, 'utf-8');

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

async function syncUsersThrottled(): Promise<{
  users: SlackUser[];
  csvPath: string;
}> {
  const csvPath = path.join(appRoot, 'slack_users.csv');
  const now = Date.now();

  if (syncInFlight) {
    return syncInFlight;
  }

  if (
    lastSyncAt &&
    now - lastSyncAt < SYNC_MIN_INTERVAL_MS &&
    cachedUsers.length
  ) {
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
  } finally {
    syncInFlight = null;
  }
}

// ---------- Window & lifecycle ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (app.isPackaged) {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  ensureLogFile();
  logEvent('INFO', 'app_started', { appRoot });
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC handlers ----------
ipcMain.handle('get-users', async () => {
  return cachedUsers;
});

ipcMain.handle('sync-users', async () => {
  try {
    const { users, csvPath } = await syncUsersThrottled();
    return {
      ok: true as const,
      users,
      csvPath,
      logPath: logFilePath,
      rateLimited: false,
      retryAfter: null,
    };
  } catch (err: unknown) {
    let msg = 'Failed to sync users from Slack.';
    let slackError: string | undefined | unknown = undefined;
    let statusCode: string | number | undefined = undefined;
    let retryAfterSeconds: number | null = null;
    let isRateLimited = false;
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      msg = typeof e.message === 'string' ? e.message : msg;
      slackError = typeof e.data === 'object' && e.data && typeof (e.data as Record<string, unknown>).error === 'string' ? (e.data as Record<string, unknown>).error : undefined;
      statusCode = typeof e.statusCode === 'string' || typeof e.statusCode === 'number' ? e.statusCode : (typeof e.code === 'string' ? e.code : undefined);
      const retryAfterHeader = typeof e.retryAfter === 'number' ? e.retryAfter : (e.data && typeof (e.data as Record<string, unknown>).retry_after === 'number' ? (e.data as Record<string, unknown>).retry_after : (e.headers && typeof (e.headers as Record<string, unknown>)['retry-after'] === 'number' ? (e.headers as Record<string, unknown>)['retry-after'] : null));
      retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
      isRateLimited = slackError === 'ratelimited' || statusCode === 429;
    }
    logEvent('ERROR', 'sync_users_failed', {
      error: msg,
      statusCode,
      retryAfter: retryAfterSeconds,
    });
    return {
      ok: false as const,
      error: msg,
      logPath: logFilePath,
      rateLimited: isRateLimited,
      retryAfter: retryAfterSeconds,
    };
  }
});

ipcMain.handle(
  'send-dms',
  async (
    event: IpcMainInvokeEvent,
    args: { userIds: string[]; text: string }
  ): Promise<{
    ok: boolean;
    sent: number;
    failed: number;
    failedUsers: { userId: string; error: string }[];
  }> => {
    const { userIds, text } = args;

    logEvent('INFO', 'send_dms_handler_invoked', {
      userCount: userIds.length,
    });

    const failedUsers: { userId: string; error: string }[] = [];
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
        } catch (err: unknown) {
          let msg = 'Unknown error sending DM.';
          if (err instanceof Error) {
            msg = err.message;
          } else if (typeof err === 'string') {
            msg = err;
          } else if (err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string') {
            msg = (err as Record<string, unknown>).message as string;
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
    } catch (err: unknown) {
      let msg = 'send_dms handler crashed unexpectedly.';
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'string') {
        msg = err;
      } else if (err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string') {
        msg = (err as Record<string, unknown>).message as string;
      }
      logEvent('ERROR', 'send_dms_handler_crashed', { error: msg });
      console.error('[main] send_dms_handler_crashed', msg);

      return {
        ok: false,
        sent: sentCount,
        failed: userIds.length,
        failedUsers:
          failedUsers.length > 0
            ? failedUsers
            : userIds.map((id) => ({ userId: id, error: msg })),
      };
    }
  }
);

ipcMain.handle('get-log-path', async () => {
  return logFilePath;
});
