import { dialog } from "electron";

export async function chooseAttachmentsDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Select folder with attachment PDFs",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return result.filePaths[0];
}
