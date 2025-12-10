import fs from "node:fs";
import { SlackUser } from "./type";

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
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
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

export function loadExistingGlatsNames(csvPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(csvPath)) return map;

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return map;

  const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headerCols.indexOf("id");
  const glatsIdx = headerCols.indexOf("glats_name");

  if (idIdx === -1 || glatsIdx === -1) return map;

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

export function loadUsersFromCsv(csvPath: string): SlackUser[] {
  if (!fs.existsSync(csvPath)) return [];

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerCols = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headerCols.indexOf("id");
  const slackNameIdx = headerCols.indexOf("slack_name");
  const emailIdx = headerCols.indexOf("email");
  const glatsIdx = headerCols.indexOf("glats_name");

  const result: SlackUser[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;

    const id = cols[idIdx]?.trim();
    if (!id) continue;

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

export function usersToCsv(users: SlackUser[]): string {
  const header = "id,slack_name,email,glats_name";
  const rows = users.map((u) =>
    [u.id, u.slackName, u.email ?? "", u.glatsName ?? ""]
      .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}
