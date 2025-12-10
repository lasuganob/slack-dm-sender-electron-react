"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chooseAttachmentsDirectory = chooseAttachmentsDirectory;
const electron_1 = require("electron");
async function chooseAttachmentsDirectory() {
    const result = await electron_1.dialog.showOpenDialog({
        title: "Select folder with attachment PDFs",
        properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
        return null;
    }
    return result.filePaths[0];
}
//# sourceMappingURL=choose-attachments-dir.js.map