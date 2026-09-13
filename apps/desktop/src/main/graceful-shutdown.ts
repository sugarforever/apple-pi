interface QuitEvent {
  preventDefault(): void;
}

interface QuitApp {
  on(event: "before-quit", listener: (event: QuitEvent) => void): unknown;
  quit(): void;
}

interface GracefulHost {
  stop(): Promise<void>;
}

export function installGracefulShutdown(app: QuitApp, host: GracefulHost): void {
  let allowQuit = false;
  let shutdown: Promise<void> | undefined;
  app.on("before-quit", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    shutdown ??= host.stop()
      .then(() => undefined, () => undefined)
      .then(() => {
        allowQuit = true;
        app.quit();
      });
  });
}
