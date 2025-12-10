import { WebClient, LogLevel } from "@slack/web-api";
import { config } from "./config";

export const slack = new WebClient(config.slackBotToken, {
  retryConfig: { retries: 0 },
  logLevel: LogLevel.WARN,
});
