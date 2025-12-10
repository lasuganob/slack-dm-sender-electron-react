"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slack = void 0;
const web_api_1 = require("@slack/web-api");
const config_1 = require("./config");
exports.slack = new web_api_1.WebClient(config_1.config.slackBotToken, {
    retryConfig: { retries: 0 },
    logLevel: web_api_1.LogLevel.WARN,
});
//# sourceMappingURL=slack-client.js.map