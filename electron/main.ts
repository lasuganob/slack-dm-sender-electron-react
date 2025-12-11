import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { ensureLogFile, logEvent, getLogFilePath } from "./src/ipc/logger";
import { appRoot } from "./src/app-root";
import {
  getCachedUsers,
  setUsersUpdatedHandler,
} from "./src/ipc/slack-users";
import { handleSyncUsers } from "./src/ipc/sync-users-handler";
import { chooseAttachmentsDirectory } from "./src/ipc/choose-attachments-dir";
import { sendDms } from "./src/ipc/send-dms";
import { openCsv } from "./src/ipc/open-csv";
import { reloadUsersFromCsv } from "./src/ipc/reload-users-from-csv";

let mainWindow: BrowserWindow | null = null;

// Notify renderer when users are updated (from slack-users module)
setUsersUpdatedHandler(({ users, csvPath }) => {
  if (mainWindow) {
    mainWindow.webContents.send("users-updated", {
      users,
      csvPath,
    });
  }
});

// ---------- Window & lifecycle ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
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
  return getCachedUsers();
});

ipcMain.handle("sync-users", async (_event, manual?: boolean) => {
  return handleSyncUsers(manual === true);
});

ipcMain.handle("choose-attachments-dir", async () => {
  return chooseAttachmentsDirectory();
});

ipcMain.handle("send-dms", async (_event, args) => {
  return sendDms(args);
});

ipcMain.handle("get-log-path", async () => {
  return getLogFilePath();
});

ipcMain.handle("open-csv", async () => {
  return openCsv();
});

ipcMain.handle("reload-users-from-csv", async () => {
  return reloadUsersFromCsv();
});
