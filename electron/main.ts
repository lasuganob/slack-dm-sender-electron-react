import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  dialog,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { WebClient, LogLevel } from "@slack/web-api";
import dotenv from "dotenv";

dotenv.config();

type SlackUser = {
  id: string;
  username: string;
  slackName: string;
  email?: string;
  glatsName?: string;
};

type AppConfig = {
  slackBotToken: string;
  sendOnlyToWfhIspUsers?: boolean;
  exceptionUserIds?: string[];
};

let mainWindow: BrowserWindow | null = null;
let cachedUsers: SlackUser[] = [];
let logFilePath: string;

let syncInFlight: Promise<{ users: SlackUser[]; csvPath: string }> | null =
  null;

const SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;

// ---------- App root & config ----------
function getAppRoot(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.length > 0) {
    return portableDir;
  }

  if (app.isPackaged) {
    return path.dirname(app.getPath("exe"));
  }
  return process.cwd();
}

const appRoot = getAppRoot();
const configPath = path.join(appRoot, "config.json");

function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.slackBotToken) {
      throw new Error("slackBotToken missing in config.json");
    }
    return {
      slackBotToken: parsed.slackBotToken,
      sendOnlyToWfhIspUsers: parsed.sendOnlyToWfhIspUsers,
      exceptionUserIds: parsed.exceptionUserIds,
    };
  } catch (err: unknown) {
    const fromEnv = process.env.SLACK_BOT_TOKEN;
    const onlySendToWfhIspUsers = process.env.ONLY_SEND_TO_WFH_ISP === "true";
    const exceptionUserIdsEnv = process.env.EXCEPTION_USER_IDS;
    const exceptionUserIds = exceptionUserIdsEnv
      ? exceptionUserIdsEnv.split(",").map((id) => id.trim())
      : [];
    if (!fromEnv) {
      throw new Error(
        `Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ""}`
      );
    }
    return {
      slackBotToken: fromEnv,
      sendOnlyToWfhIspUsers: onlySendToWfhIspUsers,
      exceptionUserIds: exceptionUserIds,
    };
  }
}

const config = loadConfig();
const slack = new WebClient(config.slackBotToken, {
  retryConfig: { retries: 0 },
  logLevel: LogLevel.WARN,
});

// ---------- CSV Readers helpers ----------
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
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
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function loadExistingGlatsNames(csvPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(csvPath)) return map;

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return map;

  const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headerCols.indexOf("id");
  const glatsIdx = headerCols.indexOf("glats_name");

  if (idIdx === -1 || glatsIdx === -1) return map;

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

function loadUsersFromCsv(csvPath: string): SlackUser[] {
  if (!fs.existsSync(csvPath)) return [];

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headerCols.indexOf("id");
  const slackNameIdx = headerCols.indexOf("slack_name");
  const emailIdx = headerCols.indexOf("email");
  const glatsIdx = headerCols.indexOf("glats_name");

  const result: SlackUser[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;

    const id = cols[idIdx]?.trim();
    if (!id) continue;

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
  logFilePath = path.join(appRoot, "slack_dm_sender.log");
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, "", "utf-8");
  }
}

function logEvent(
  level: "INFO" | "ERROR",
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
  fs.appendFile(logFilePath, JSON.stringify(entry) + "\n", () => {
    // ignore write error
  });
}

// ---------- Slack + CSV helpers ----------
async function fetchUsersFromSlack(): Promise<SlackUser[]> {
  const users: SlackUser[] = [];
  let cursor: string | undefined;
  const sendOnlyToWfhIspUsers = config.sendOnlyToWfhIspUsers || false;

  do {
    const res = await slack.users.list({ cursor, limit: 200 });

    if (res.members) {
      for (const m of res.members) {
        if (!m || m.deleted || m.is_bot || m.id === "USLACKBOT") continue;

        const profile = m.profile ?? {};
        const displayName = profile.display_name || "";
        const slackName = profile.display_name || profile.real_name || "";

        const displayNameLower = displayName.toLowerCase();
        const hasWfhOrIsp =
          /\bWFH\b/i.test(displayNameLower) ||
          /\bISP\b/i.test(displayNameLower);
        // @TODO: Delete after testing
        const exceptionIds = config.exceptionUserIds || [];
        if (
          !hasWfhOrIsp &&
          sendOnlyToWfhIspUsers &&
          !exceptionIds.includes(m.id!)
        ) {
          continue;
        }

        users.push({
          id: m.id!,
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

function usersToCsv(users: SlackUser[]): string {
  const header = "id,slack_name,email,glats_name";
  const rows = users.map((u) =>
    [u.id, u.slackName, u.email ?? "", u.glatsName ?? ""]
      .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

async function syncUsersCore(): Promise<{
  users: SlackUser[];
  csvPath: string;
}> {
  logEvent("INFO", "sync_users_started");

  const csvPath = path.join(appRoot, "slack_users.csv");
  const existingGlats = loadExistingGlatsNames(csvPath);

  const fetched = await fetchUsersFromSlack();

  const merged: SlackUser[] = fetched.map((u) => ({
    ...u,
    glatsName: existingGlats.get(u.id) ?? "",
  }));

  cachedUsers = merged;

  const csv = usersToCsv(merged);
  fs.writeFileSync(csvPath, csv, "utf-8");

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

async function syncUsersThrottled(): Promise<{
  users: SlackUser[];
  csvPath: string;
}> {
  const csvPath = path.join(appRoot, "slack_users.csv");
  const now = Date.now();

  if (syncInFlight) {
    return syncInFlight;
  }

  const csvExists = fs.existsSync(csvPath);
  const csvMtime = csvExists ? fs.statSync(csvPath).mtimeMs : null;
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
  } finally {
    syncInFlight = null;
  }
}

// ---------- Window & lifecycle ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 620,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (app.isPackaged) {
    const indexPath = path.join(__dirname, "../dist/index.html");
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  ensureLogFile();
  logEvent("INFO", "app_started", { appRoot });
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC handlers ----------
ipcMain.handle("get-users", async () => {
  return cachedUsers;
});

ipcMain.handle("sync-users", async () => {
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
    let msg = "Failed to sync users from Slack.";
    let slackError: string | undefined = undefined;
    let statusCode: string | number | undefined = undefined;
    let retryAfterSeconds: number | null = null;
    let isRateLimited = false;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      msg = typeof e.message === "string" ? e.message : msg;
      if (typeof e.data === "object" && e.data !== null) {
        const errorVal = (e.data as Record<string, unknown>).error;
        slackError = typeof errorVal === "string" ? errorVal : undefined;
      }
      statusCode =
        typeof e.statusCode === "string" || typeof e.statusCode === "number"
          ? e.statusCode
          : typeof e.code === "string"
          ? e.code
          : undefined;
      const retryAfterHeader =
        typeof e.retryAfter === "number"
          ? e.retryAfter
          : e.data &&
            typeof (e.data as Record<string, unknown>).retry_after === "number"
          ? (e.data as Record<string, unknown>).retry_after
          : e.headers &&
            typeof (e.headers as Record<string, unknown>)["retry-after"] ===
              "number"
          ? (e.headers as Record<string, unknown>)["retry-after"]
          : null;
      retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
      isRateLimited = slackError === "ratelimited" || statusCode === 429;
    }
    const csvPath = path.join(appRoot, "slack_users.csv");

    if (isRateLimited && fs.existsSync(csvPath)) {
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
      ok: false as const,
      error: msg,
      logPath: logFilePath,
      rateLimited: isRateLimited,
      retryAfter: retryAfterSeconds,
    };
  }
});

ipcMain.handle("choose-attachments-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select folder with attachment PDFs",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle(
  "send-dms",
  async (
    event: IpcMainInvokeEvent,
    args: { userIds: string[]; text: string; attachmentsDir?: string | null }
  ): Promise<{
    ok: boolean;
    sent: number;
    failed: number;
    failedUsers: { userId: string; error: string }[];
  }> => {
    const { userIds, text, attachmentsDir } = args;
    logEvent("INFO", "send_dms_handler_invoked", {
      userCount: userIds.length,
      attachmentsDir,
    });

    const failedUsers: { userId: string; error: string }[] = [];
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

        let filePath: string | null = null;
        if (attachmentsDir) {
          const expected = path.join(attachmentsDir, `${user.glatsName}.pdf`);
          if (fs.existsSync(expected)) {
            filePath = expected;
          } else {
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
              file: fs.createReadStream(filePath),
              filename: path.basename(filePath),
              initial_comment: fullText || undefined,
            });
          } else {
            await slack.chat.postMessage({ channel: channelId, text: fullText });
          }

          sentCount += 1;
          logEvent("INFO", "send_dm_success", {
            userId,
            filePath: filePath ?? null,
          });
        } catch (err: unknown) {
          let msg = "Unknown error sending DM.";
          if (err instanceof Error) {
            msg = err.message;
          } else if (typeof err === "string") {
            msg = err;
          } else if (
            err &&
            typeof err === "object" &&
            "message" in err &&
            typeof (err as Record<string, unknown>).message === "string"
          ) {
            msg = (err as Record<string, unknown>).message as string;
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
    } catch (err: unknown) {
      let msg = "send_dms handler crashed unexpectedly.";
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === "string") {
        msg = err;
      } else if (
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as Record<string, unknown>).message === "string"
      ) {
        msg = (err as Record<string, unknown>).message as string;
      }
      logEvent("ERROR", "send_dms_handler_crashed", { error: msg });

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

ipcMain.handle("get-log-path", async () => {
  return logFilePath;
});

ipcMain.handle("open-csv", async () => {
  const csvPath = path.join(appRoot, "slack_users.csv");

  if (!fs.existsSync(csvPath)) {
    const msg = `slack_users.csv not found at ${csvPath}`;
    logEvent("ERROR", "open_csv_not_found", { csvPath });
    throw new Error(msg);
  }

  const result = await shell.openPath(csvPath);
  if (result) {
    logEvent("ERROR", "open_csv_failed", { csvPath, error: result });
    throw new Error(`Failed to open CSV: ${result}`);
  }

  logEvent("INFO", "open_csv_success", { csvPath });
  return true;
});
