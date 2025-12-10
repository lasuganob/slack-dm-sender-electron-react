import { app } from "electron";
import path from "node:path";

export function getAppRoot(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.length > 0) {
    return portableDir;
  }

  if (app.isPackaged) {
    return path.dirname(app.getPath("exe"));
  }
  return process.cwd();
}

export const appRoot = getAppRoot();
export const configPath = path.join(appRoot, "config.json");
