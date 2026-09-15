interface HostHandler {
  handle(input: unknown): Promise<{ ok: boolean }>;
}

export async function dispatchHostMessage(server: HostHandler, message: unknown, write: (response: unknown) => Promise<void>, exit: () => void): Promise<void> {
  const response = await server.handle(message);
  await write(response);
  if ((message as { type?: unknown })?.type === "system.shutdown" && response.ok) exit();
}
