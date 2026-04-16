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
      exceptionUserIds: parsed.exceptionUserIds,
      keywords: parsed.keywords || ["WFH", "ISP"],
    };
  } catch (err: unknown) {
    const fromEnv = process.env.SLACK_BOT_TOKEN;
    
    const exceptionUserIdsEnv = process.env.EXCEPTION_USER_IDS;
    const exceptionUserIds = exceptionUserIdsEnv
      ? exceptionUserIdsEnv.split(",").map((id) => id.trim())
      : [];

    const keywordsEnv = process.env.KEYWORDS;
    const keywords = keywordsEnv
      ? keywordsEnv.split(",").map((k) => k.trim())
      : ["WFH", "ISP"];

    if (!fromEnv) {
      throw new Error(
        `Failed to load config.json at ${configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ""}`
      );
    }
    return {
      slackBotToken: fromEnv,
      exceptionUserIds: exceptionUserIds,
      keywords: keywords,
    };
  }
}

export const config = loadConfig();
