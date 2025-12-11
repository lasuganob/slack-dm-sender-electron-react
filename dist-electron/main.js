"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("./src/ipc/logger");
const app_root_1 = require("./src/app-root");
const slack_users_1 = require("./src/ipc/slack-users");
const sync_users_handler_1 = require("./src/ipc/sync-users-handler");
const choose_attachments_dir_1 = require("./src/ipc/choose-attachments-dir");
const send_dms_1 = require("./src/ipc/send-dms");
const open_csv_1 = require("./src/ipc/open-csv");
const reload_users_from_csv_1 = require("./src/ipc/reload-users-from-csv");
let mainWindow = null;
// Notify renderer when users are updated (from slack-users module)
(0, slack_users_1.setUsersUpdatedHandler)(({ users, csvPath }) => {
    if (mainWindow) {
        mainWindow.webContents.send("users-updated", {
            users,
            csvPath,
        });
    }
});
// ---------- Window & lifecycle ----------
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 600,
        height: 700,
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
    (0, logger_1.ensureLogFile)();
    (0, logger_1.logEvent)("INFO", "app_started", { appRoot: app_root_1.appRoot });
    createWindow();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ---------- IPC handlers ----------
electron_1.ipcMain.handle("get-users", async () => {
    return (0, slack_users_1.getCachedUsers)();
});
electron_1.ipcMain.handle("sync-users", async (_event, manual) => {
    return (0, sync_users_handler_1.handleSyncUsers)(manual === true);
});
electron_1.ipcMain.handle("choose-attachments-dir", async () => {
    return (0, choose_attachments_dir_1.chooseAttachmentsDirectory)();
});
electron_1.ipcMain.handle("send-dms", async (_event, args) => {
    return (0, send_dms_1.sendDms)(args);
});
electron_1.ipcMain.handle("get-log-path", async () => {
    return (0, logger_1.getLogFilePath)();
});
electron_1.ipcMain.handle("open-csv", async () => {
    return (0, open_csv_1.openCsv)();
});
electron_1.ipcMain.handle("reload-users-from-csv", async () => {
    return (0, reload_users_from_csv_1.reloadUsersFromCsv)();
});
//# sourceMappingURL=main.js.map