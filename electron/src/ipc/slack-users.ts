import fs from "node:fs";
import path from "node:path";

import { appRoot } from "../app-root";
import { config } from "../config";
import {
  loadExistingGlatsNames,
  loadUsersFromCsv,
  usersToCsv,
} from "../csv-helper";
import { slack } from "../slack-client";
import { SlackUser } from "../type";
import { logEvent } from "./logger";

const SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;

let cachedUsers: SlackUser[] = [];
let syncInFlight: Promise<{ users: SlackUser[]; csvPath: string }> | null =
  null;

type UsersUpdatedHandler = (payload: {
  users: SlackUser[];
  csvPath: string;
}) => void;

let usersUpdatedHandler: UsersUpdatedHandler | null = null;

export function setUsersUpdatedHandler(handler: UsersUpdatedHandler | null) {
  usersUpdatedHandler = handler;
}

export function getCachedUsers(): SlackUser[] {
  return cachedUsers;
}

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
        const slackName = profile.display_name || profile.real_name || m.name || "";

        const slackNameLower = slackName.toLowerCase();
        const hasWfhOrIsp =
          /\bWFH\b/i.test(slackNameLower) || /\bISP\b/i.test(slackNameLower);

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

export async function syncUsersCore(): Promise<{
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

  if (usersUpdatedHandler) {
    usersUpdatedHandler({
      users: cachedUsers,
      csvPath,
    });
  }

  return { users: cachedUsers, csvPath };
}

export function hydrateCachedUsersFromCsv(csvPath: string): void {
  const fromCsv = loadUsersFromCsv(csvPath);
  const existingGlats = loadExistingGlatsNames(csvPath);
  cachedUsers = fromCsv.map((u) => ({
    ...u,
    glatsName: existingGlats.get(u.id) ?? u.glatsName ?? "",
  }));
}

export async function syncUsersThrottled(): Promise<{
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
    hydrateCachedUsersFromCsv(csvPath);
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
