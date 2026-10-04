import { app, Menu, type MenuItemConstructorOptions } from "electron";
import type { AppCommand } from "../shared/pi-api.js";

/**
 * The native menu. Items that act on the window's UI forward one `AppCommand`
 * to the renderer; quitting, editing, zoom, and window management stay native roles.
 */
export function installAppMenu(send: (command: AppCommand) => void): void {
  const isMac = process.platform === "darwin";
  const item = (label: string, accelerator: string, command: AppCommand): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(command) });
  const settings = item(isMac ? "Settings…" : "Settings", "CmdOrCtrl+,", "open-settings");
  const separator: MenuItemConstructorOptions = { type: "separator" };

  const appMenu: MenuItemConstructorOptions = {
    role: "appMenu",
    submenu: [
      { role: "about" },
      separator,
      settings,
      separator,
      { role: "services" },
      separator,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      separator,
      { role: "quit" },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    {
      label: "File",
      submenu: [
        item("New Chat", "CmdOrCtrl+N", "new-chat"),
        item("Add Project…", "CmdOrCtrl+Shift+O", "add-project"),
        separator,
        // Elsewhere there is no app menu, so Settings and Quit live here.
        ...(isMac ? [{ role: "close" as const }] : [settings, separator, { role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        item("Toggle Sidebar", "CmdOrCtrl+B", "toggle-sidebar"),
        item("Search Chats", "CmdOrCtrl+K", "search-chats"),
        separator,
        item("Previous Chat", "CmdOrCtrl+[", "previous-chat"),
        item("Next Chat", "CmdOrCtrl+]", "next-chat"),
        separator,
        // Packaged windows have dev tools disabled, so these are for development only.
        ...(app.isPackaged ? [] : [{ role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }, separator]),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        separator,
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
