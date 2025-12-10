"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDms = sendDms;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const slack_client_1 = require("../slack-client");
const logger_1 = require("./logger");
const slack_users_1 = require("./slack-users");
async function sendDms(args) {
    const { userIds, text, attachmentsDir } = args;
    (0, logger_1.logEvent)("INFO", "send_dms_handler_invoked", {
        userCount: userIds.length,
        attachmentsDir,
    });
    const failedUsers = [];
    let sentCount = 0;
    try {
        const cachedUsers = (0, slack_users_1.getCachedUsers)();
        for (const userId of userIds) {
            const user = cachedUsers.find((u) => u.id === userId);
            if (!user) {
                const msg = "User not found in cache (sync may be stale).";
                (0, logger_1.logEvent)("ERROR", "send_dm_failed", { userId, error: msg });
                failedUsers.push({ userId, error: msg });
                continue;
            }
            let filePath = null;
            if (attachmentsDir) {
                const expected = node_path_1.default.join(attachmentsDir, `${user.glatsName}.pdf`);
                if (node_fs_1.default.existsSync(expected)) {
                    filePath = expected;
                }
                else {
                    const msg = `Attachment not found: ${expected}`;
                    (0, logger_1.logEvent)("ERROR", "attachment_missing", { userId, expected });
                    failedUsers.push({ userId, error: msg });
                    continue;
                }
            }
            try {
                const conv = await slack_client_1.slack.conversations.open({ users: userId });
                const channelId = conv.channel?.id;
                if (!channelId) {
                    throw new Error("No channel id returned by Slack.");
                }
                const greetingText = `Hello ${user.glatsName || user.slackName},\n\n`;
                const fullText = greetingText + text;
                if (filePath) {
                    await slack_client_1.slack.files.uploadV2({
                        channels: channelId,
                        file: node_fs_1.default.createReadStream(filePath),
                        filename: node_path_1.default.basename(filePath),
                        initial_comment: fullText || undefined,
                    });
                }
                else {
                    await slack_client_1.slack.chat.postMessage({ channel: channelId, text: fullText });
                }
                sentCount += 1;
                (0, logger_1.logEvent)("INFO", "send_dm_success", {
                    userId,
                    filePath: filePath ?? null,
                });
            }
            catch (err) {
                let msg = "Unknown error sending DM.";
                if (err instanceof Error) {
                    msg = err.message;
                }
                else if (typeof err === "string") {
                    msg = err;
                }
                else if (err &&
                    typeof err === "object" &&
                    "message" in err &&
                    typeof err.message === "string") {
                    msg = err.message;
                }
                (0, logger_1.logEvent)("ERROR", "send_dm_failed", { userId, error: msg });
                failedUsers.push({ userId, error: msg });
            }
        }
        const ok = failedUsers.length === 0;
        (0, logger_1.logEvent)("INFO", "send_dms_finished", {
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
    }
    catch (err) {
        let msg = "send_dms handler crashed unexpectedly.";
        if (err instanceof Error) {
            msg = err.message;
        }
        else if (typeof err === "string") {
            msg = err;
        }
        else if (err &&
            typeof err === "object" &&
            "message" in err &&
            typeof err.message === "string") {
            msg = err.message;
        }
        (0, logger_1.logEvent)("ERROR", "send_dms_handler_crashed", { error: msg });
        return {
            ok: false,
            sent: 0,
            failed: userIds.length,
            failedUsers: failedUsers.length > 0
                ? failedUsers
                : userIds.map((id) => ({ userId: id, error: msg })),
        };
    }
}
//# sourceMappingURL=send-dms.js.map