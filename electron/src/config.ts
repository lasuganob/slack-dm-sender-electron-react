import dotenv from "dotenv";
import fs from "node:fs";
import { configPath } from "./app-root";
import { AppConfig } from "./type";

dotenv.config();

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.slackBotToken) {
      throw new Error("slackBotToken missing in config.json");
    }
    return {
      slackBotToken: parsed.slackBotToken,
      sendOnlyToWfhIspUsers: parsed.sendOnlyToWfhIspUsers,
      exceptionUserIds: parsed.exceptionUserIds,
    };
  } catch (err: unknown) {
    const fromEnv = process.env.SLACK_BOT_TOKEN;
    const onlySendToWfhIspUsers = process.env.ONLY_SEND_TO_WFH_ISP === "true";
    const exceptionUserIdsEnv = process.env.EXCEPTION_USER_IDS;
    const exceptionUserIds = exceptionUserIdsEnv
      ? exceptionUserIdsEnv.split(",").map((id) => id.trim())
      : [];
    if (!fromEnv) {
      throw new Error(
        `Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ""}`
      );
    }
    return {
      slackBotToken: fromEnv,
      sendOnlyToWfhIspUsers: onlySendToWfhIspUsers,
      exceptionUserIds: exceptionUserIds,
    };
  }
}

export const config = loadConfig();
