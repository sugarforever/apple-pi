import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

app.commandLine.appendSwitch("force-device-scale-factor", "1");
// Software rasterization bounds run-to-run variance to ±1 channel noise on tile seams.
app.disableHardwareAcceleration();
if (process.env.CODEX_CI) app.commandLine.appendSwitch("no-sandbox");

async function waitForFixture(window, fixture) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript("document.documentElement.dataset.visualFixtureReady || ''");
    if (ready === fixture) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Fixture did not become ready: ${fixture}`);
}

app
  .whenReady()
  .then(async () => {
    const plan = JSON.parse(process.env.APPLE_PI_VISUAL_CAPTURE_PLAN || "[]");
    const outputDirectory = process.env.APPLE_PI_VISUAL_OUTPUT_DIR;
    const rendererFile = process.env.APPLE_PI_VISUAL_RENDERER_FILE;
    if (!outputDirectory || !rendererFile || plan.length === 0) throw new Error("Visual capture environment is incomplete");

    // One window for the whole plan: destroying a window tears down the shared
    // renderer process and aborts the next window's file load.
    const window = new BrowserWindow({
      width: plan[0].viewport.width,
      height: plan[0].viewport.height,
      useContentSize: true,
      show: false,
      backgroundColor: "#0b0d0d",
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    window.webContents.on("console-message", (event) => console.error(`[renderer:${event.level}] ${event.message}`));
    await window.loadURL("about:blank");
    window.webContents.debugger.attach("1.3");
    // Hidden windows never receive page focus; emulate it so :focus-visible fixtures render their rings.
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    for (const item of plan) {
      window.setContentSize(item.viewport.width, item.viewport.height);
      // Pin 1x through CDP; the command-line switch alone does not reach captures on HiDPI macOS displays.
      await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        ...item.viewport,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // A query change forces a full document load; a hash-only change would not re-render.
      await window.loadFile(rendererFile, { query: { "visual-fixture": item.fixture } });
      await waitForFixture(window, item.fixture);
      const { data } = await window.webContents.debugger.sendCommand("Page.captureScreenshot", { format: "png" });
      await writeFile(join(outputDirectory, item.filename), Buffer.from(data, "base64"));
    }
    window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.exit(1);
  });
