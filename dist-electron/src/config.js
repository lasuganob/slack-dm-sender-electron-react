"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.loadConfig = loadConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const node_fs_1 = __importDefault(require("node:fs"));
const app_root_1 = require("./app-root");
dotenv_1.default.config();
function loadConfig() {
    try {
        const raw = node_fs_1.default.readFileSync(app_root_1.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed.slackBotToken) {
            throw new Error("slackBotToken missing in config.json");
        }
        return {
            slackBotToken: parsed.slackBotToken,
            exceptionUserIds: parsed.exceptionUserIds,
            keywords: parsed.keywords || ["WFH", "ISP"],
        };
    }
    catch (err) {
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
            throw new Error(`Failed to load config.json at ${app_root_1.configPath} and SLACK_BOT_TOKEN env is not set. 
        ${err instanceof Error ? err.message : ""}`);
        }
        return {
            slackBotToken: fromEnv,
            exceptionUserIds: exceptionUserIds,
            keywords: keywords,
        };
    }
}
exports.config = loadConfig();
//# sourceMappingURL=config.js.map