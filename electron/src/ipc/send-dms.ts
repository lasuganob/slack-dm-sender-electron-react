import fs from "node:fs";
import path from "node:path";

import { slack } from "../slack-client";
import { logEvent } from "./logger";
import { getCachedUsers } from "./slack-users";

export type SendDmsArgs = {
  userIds: string[];
  text: string;
  attachmentsDir?: string | null;
};

export type SendDmsResult = {
  ok: boolean;
  sent: number;
  failed: number;
  failedUsers: { userId: string; error: string }[];
};

export async function sendDms(args: SendDmsArgs): Promise<SendDmsResult> {
  const { userIds, text, attachmentsDir } = args;

  logEvent("INFO", "send_dms_handler_invoked", {
    userCount: userIds.length,
    attachmentsDir,
  });

  const failedUsers: { userId: string; error: string }[] = [];
  let sentCount = 0;

  try {
    const cachedUsers = getCachedUsers();

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
        const expected = path.join(attachmentsDir, `${user.glatsName || user.slackName}.pdf`);
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
      sent: 0,
      failed: userIds.length,
      failedUsers:
        failedUsers.length > 0
          ? failedUsers
          : userIds.map((id) => ({ userId: id, error: msg })),
    };
  }
}
