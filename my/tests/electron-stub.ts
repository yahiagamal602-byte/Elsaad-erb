export const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
export const ipcMain = {
	handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler),
};
export const app = { getPath: () => '' };
export const BrowserWindow = { fromWebContents: () => null };
export const dialog = { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) };