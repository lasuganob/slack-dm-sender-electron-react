export type SlackUser = {
  id: string;
  username: string;
  slackName: string;
  email?: string;
  glatsName?: string;
};

export type SyncUsersResult =
  | {
      ok: true;
      users: SlackUser[];
      csvPath: string;
      logPath: string;
      rateLimited: false;
      retryAfter: null;
    }
  | {
      ok: false;
      error: string;
      logPath: string;
      rateLimited: boolean;
      retryAfter: number | null;
    };

export type SendDmsResult = {
  ok: boolean;
  sent: number;
  failed: number;
  failedUsers: { userId: string; error: string }[];
};

declare global {
  interface Window {
    api: {
      getUsers: () => Promise<SlackUser[]>;
      syncUsers: (manual?: boolean) => Promise<SyncUsersResult>;
      sendDms: (
        userIds: string[],
        text: string,
        attachmentsDir: string | null
      ) => Promise<SendDmsResult>;
      getLogPath: () => Promise<string>;
      chooseAttachmentsDir: () => Promise<string | null>;
      openCsv: () => Promise<boolean>; 
      reloadUsersFromCsv: () => Promise<SyncUsersResult>;
      onUsersUpdated: (
        cb: (payload: { users: SlackUser[]; csvPath: string }) => void
      ) => void;
    };
  }
}

export {};
