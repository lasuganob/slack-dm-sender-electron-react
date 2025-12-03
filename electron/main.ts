import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';

dotenv.config();

type AppConfig = {
  slackBotToken: string;
};

type SlackUser = {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  email?: string;
};

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
  } catch {
    const fromEnv = process.env.SLACK_BOT_TOKEN;
    if (!fromEnv) {
      throw new Error(
        `Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set`
      );
    }
    return { slackBotToken: fromEnv };
  }
}

let mainWindow: BrowserWindow | null = null;
let cachedUsers: SlackUser[] = [];
let logFilePath: string;

const config = loadConfig();
const slack = new WebClient(config.slackBotToken);

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
      // ignore write errors
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

    const meta = res.response_metadata;
    cursor = meta?.next_cursor ? meta.next_cursor : undefined;
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

async function syncUsers() {
  logEvent('INFO', 'sync_users_started');
  try {
    const rawUsers = await fetchUsersFromSlack();

    const map = new Map<string, SlackUser>();
    for (const u of rawUsers) {
      map.set(u.id, u);
    }
    cachedUsers = Array.from(map.values());

    const csv = usersToCsv(cachedUsers);
    const csvPath = path.join(appRoot, 'slack_users.csv'); // 👈 same folder as exe
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
  } catch (err: unknown) {
    let errorMsg = 'Unknown error';
    if (err instanceof Error) {
      errorMsg = err.message;
    } else if (typeof err === 'string') {
      errorMsg = err;
    }
    logEvent('ERROR', 'sync_users_failed', {
      error: errorMsg,
    });
    throw err;
  }
}

// ---------- Window & app lifecycle ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
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
  logEvent('INFO', 'app_started');
  createWindow();

  try {
    await syncUsers();
  } catch {
    // Already logged; renderer will get errors via IPC when it tries to sync
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC handlers ----------

ipcMain.handle('get-users', async () => {
  if (!cachedUsers.length) {
    await syncUsers();
  }
  return cachedUsers;
});

ipcMain.handle('sync-users', async () => {
  try {
    const { users, csvPath } = await syncUsers();
    return { ok: true, users, csvPath, logPath: logFilePath };
  } catch (err: unknown) {
    let errorMsg = 'Failed to sync users from Slack.';
    if (err instanceof Error) {
      errorMsg = err.message;
    } else if (typeof err === 'string') {
      errorMsg = err;
    }
    return {
      ok: false,
      error: errorMsg,
      logPath: logFilePath,
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
    console.log('[main] send-dms invoked', { userIdsCount: userIds.length });

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
