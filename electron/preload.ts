import { contextBridge, ipcRenderer } from 'electron';
import { SlackUser } from '../src/global';

contextBridge.exposeInMainWorld('api', {
  getUsers: () => ipcRenderer.invoke('get-users'),
  syncUsers: () => ipcRenderer.invoke('sync-users'),
  sendDms: (userIds: string[], text: string) =>
    ipcRenderer.invoke('send-dms', { userIds, text }),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  onUsersUpdated: (
    callback: (payload: { users: SlackUser[]; csvPath: string }) => void
  ) => {
    ipcRenderer.on('users-updated', (_event, payload) => callback(payload));
  },
});
