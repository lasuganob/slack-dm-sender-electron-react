"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPath = exports.appRoot = void 0;
exports.getAppRoot = getAppRoot;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
function getAppRoot() {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && portableDir.length > 0) {
        return portableDir;
    }
    if (electron_1.app.isPackaged) {
        return node_path_1.default.dirname(electron_1.app.getPath("exe"));
    }
    return process.cwd();
}
exports.appRoot = getAppRoot();
exports.configPath = node_path_1.default.join(exports.appRoot, "config.json");
//# sourceMappingURL=app-root.js.map