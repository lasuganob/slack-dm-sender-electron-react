import { contextBridge, ipcRenderer } from 'electron';
import { SlackUser } from '../src/global';

contextBridge.exposeInMainWorld('api', {
  getUsers: () => ipcRenderer.invoke('get-users'),
  syncUsers: (manual = false) => ipcRenderer.invoke('sync-users', manual),
  sendDms: (userIds: string[], text: string, attachmentsDir: null) =>
    ipcRenderer.invoke('send-dms', { userIds, text, attachmentsDir }),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  chooseAttachmentsDir: () => ipcRenderer.invoke('choose-attachments-dir'),
  openCsv: () => ipcRenderer.invoke('open-csv'),
  reloadUsersFromCsv: () => ipcRenderer.invoke('reload-users-from-csv'),
  onUsersUpdated: (
    callback: (payload: { users: SlackUser[]; csvPath: string }) => void
  ) => {
    ipcRenderer.on('users-updated', (_event, payload) => callback(payload));
  },
});
