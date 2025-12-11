import path from "node:path";
import fs from "node:fs";

import { appRoot } from "../app-root";
import {
  syncUsersThrottled,
  hydrateCachedUsersFromCsv,
  syncUsersCore,
} from "./slack-users";
import { logEvent, getLogFilePath } from "./logger";
import { SlackUser } from "../type";

type SyncUsersSuccessResponse = {
  ok: true;
  users: SlackUser[];
  csvPath: string;
  logPath?: string;
  rateLimited: false;
  retryAfter: null;
};

type SyncUsersErrorResponse = {
  ok: false;
  error: string;
  logPath?: string;
  rateLimited: boolean;
  retryAfter: number | null;
};

export type SyncUsersResponse =
  | SyncUsersSuccessResponse
  | SyncUsersErrorResponse;

export async function handleSyncUsers(manual?: boolean): Promise<SyncUsersResponse> {
  console.log("handleSyncUsers called with manual =", manual);
  try {
    const { users, csvPath } = manual ? await syncUsersCore() : await syncUsersThrottled();
    return {
      ok: true as const,
      users,
      csvPath,
      logPath: getLogFilePath(),
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
      hydrateCachedUsersFromCsv(csvPath);

      logEvent("INFO", "sync_users_rate_limited_using_cache", {
        csvPath,
        retryAfter: retryAfterSeconds,
      });

      return {
        ok: false,
        error: msg,
        logPath: getLogFilePath(),
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
      logPath: getLogFilePath(),
      rateLimited: isRateLimited,
      retryAfter: retryAfterSeconds,
    };
  }
}
