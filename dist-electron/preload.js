"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    getUsers: () => electron_1.ipcRenderer.invoke('get-users'),
    syncUsers: () => electron_1.ipcRenderer.invoke('sync-users'),
    sendDms: (userIds, text, attachmentsDir) => electron_1.ipcRenderer.invoke('send-dms', { userIds, text, attachmentsDir }),
    getLogPath: () => electron_1.ipcRenderer.invoke('get-log-path'),
    chooseAttachmentsDir: () => electron_1.ipcRenderer.invoke('choose-attachments-dir'),
    openCsv: () => electron_1.ipcRenderer.invoke('open-csv'),
    reloadUsersFromCsv: () => electron_1.ipcRenderer.invoke('reload-users-from-csv'),
    onUsersUpdated: (callback) => {
        electron_1.ipcRenderer.on('users-updated', (_event, payload) => callback(payload));
    },
});
//# sourceMappingURL=preload.js.map