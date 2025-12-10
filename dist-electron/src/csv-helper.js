"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsvLine = parseCsvLine;
exports.loadExistingGlatsNames = loadExistingGlatsNames;
exports.loadUsersFromCsv = loadUsersFromCsv;
exports.usersToCsv = usersToCsv;
const node_fs_1 = __importDefault(require("node:fs"));
function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === "," && !inQuotes) {
            values.push(current);
            current = "";
        }
        else {
            current += ch;
        }
    }
    values.push(current);
    return values;
}
function loadExistingGlatsNames(csvPath) {
    const map = new Map();
    if (!node_fs_1.default.existsSync(csvPath))
        return map;
    const raw = node_fs_1.default.readFileSync(csvPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2)
        return map;
    const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idIdx = headerCols.indexOf("id");
    const glatsIdx = headerCols.indexOf("glats_name");
    if (idIdx === -1 || glatsIdx === -1)
        return map;
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const id = cols[idIdx]?.trim();
        const glats = cols[glatsIdx]?.trim();
        if (id) {
            map.set(id, glats ?? "");
        }
    }
    return map;
}
function loadUsersFromCsv(csvPath) {
    if (!node_fs_1.default.existsSync(csvPath))
        return [];
    const raw = node_fs_1.default.readFileSync(csvPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2)
        return [];
    const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idIdx = headerCols.indexOf("id");
    const slackNameIdx = headerCols.indexOf("slack_name");
    const emailIdx = headerCols.indexOf("email");
    const glatsIdx = headerCols.indexOf("glats_name");
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (!cols.length)
            continue;
        const id = cols[idIdx]?.trim();
        if (!id)
            continue;
        result.push({
            id,
            username: "",
            slackName: cols[slackNameIdx] ?? "",
            email: cols[emailIdx] || undefined,
            glatsName: cols[glatsIdx] || "",
        });
    }
    return result;
}
function usersToCsv(users) {
    const header = "id,slack_name,email,glats_name";
    const rows = users.map((u) => [u.id, u.slackName, u.email ?? "", u.glatsName ?? ""]
        .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
        .join(","));
    return [header, ...rows].join("\n");
}
//# sourceMappingURL=csv-helper.js.map