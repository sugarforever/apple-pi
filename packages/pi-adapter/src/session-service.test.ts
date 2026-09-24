import { beforeEach, describe, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  listSessions: vi.fn(async () => []),
  createManager: vi.fn((cwd: string) => ({ cwd })),
  openManager: vi.fn((path: string, _sessionDir: unknown, cwd: string) => ({ cwd, path })),
  completeSimple: vi.fn(),
  createRuntime: vi.fn(async () => ({
    getAvailableSnapshot: () => [],
    getModel: (): { provider: string; id: string; name: string } | undefined => undefined,
    completeSimple: pi.completeSimple,
  })),
  reloadResourceLoader: vi.fn(async () => {}),
}));

const DefaultResourceLoaderMock = vi.hoisted(() =>
  vi.fn(function (this: unknown, options: { cwd: string; agentDir: string }) {
    return { options, reload: pi.reloadResourceLoader, getSkills: () => ({ skills: [], diagnostics: [] }) };
  }),
);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: pi.createAgentSession,
  SessionManager: {
    list: pi.listSessions,
    create: pi.createManager,
    open: pi.openManager,
  },
  ModelRuntime: { create: pi.createRuntime },
  DefaultResourceLoader: DefaultResourceLoaderMock,
  getAgentDir: () => "/fake/agent-dir",
}));

import { PiSessionService } from "./index.js";

describe("PiSessionService lifecycle ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pi.listSessions.mockResolvedValue([]);
    pi.createAgentSession.mockReset();
    pi.completeSimple.mockReset();
  });

  it("releases a replaced streaming session once and blocks its stale events", async () => {
    const first = sessionDouble("first", true);
    const second = sessionDouble("second");
    pi.createAgentSession.mockResolvedValueOnce({ session: first.session }).mockResolvedValueOnce({ session: second.session });
    const events = vi.fn();
    const service = new PiSessionService();
    service.onEvent(events);

    await service.open("/workspace", undefined, undefined, true);
    const staleListener = first.listener();
    await service.open("/workspace", undefined, undefined, true);
    staleListener({ type: "agent_start" });

    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(first.abort).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(events).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({ opened: true, sessionId: "second" });
  });

  it("keeps the current session subscribed when replacement creation fails", async () => {
    const first = sessionDouble("first");
    pi.createAgentSession.mockResolvedValueOnce({ session: first.session }).mockRejectedValueOnce(new Error("replacement failed"));
    const events = vi.fn();
    const service = new PiSessionService();
    service.onEvent(events);

    await service.open("/workspace", undefined, undefined, true);
    const currentListener = first.listener();
    await expect(service.open("/workspace", undefined, undefined, true)).rejects.toThrow("replacement failed");
    currentListener({ type: "agent_start" });

    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(first.abort).not.toHaveBeenCalled();
    expect(first.dispose).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledWith({ type: "lifecycle", phase: "started" });
    expect(service.snapshot()).toMatchObject({ opened: true, sessionId: "first" });
  });

  it("keeps a committed replacement when old-session cleanup reports an error", async () => {
    const first = sessionDouble("first");
    first.abort.mockRejectedValueOnce(new Error("abort hook failed"));
    const second = sessionDouble("second");
    pi.createAgentSession.mockResolvedValueOnce({ session: first.session }).mockResolvedValueOnce({ session: second.session });
    const service = new PiSessionService();

    await service.open("/workspace", undefined, undefined, true);
    await expect(service.open("/workspace", undefined, undefined, true)).resolves.toMatchObject({ opened: true, sessionId: "second" });

    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(first.abort).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("serializes concurrent replacements in call order", async () => {
    const firstCreation = deferred<{ session: ReturnType<typeof sessionDouble>["session"] }>();
    const first = sessionDouble("first");
    const second = sessionDouble("second");
    pi.createAgentSession.mockImplementationOnce(() => firstCreation.promise).mockResolvedValueOnce({ session: second.session });
    const service = new PiSessionService();

    const openingFirst = service.open("/first", undefined, undefined, true);
    const openingSecond = service.open("/second", undefined, undefined, true);
    await vi.waitFor(() => expect(pi.createAgentSession).toHaveBeenCalledTimes(1));

    firstCreation.resolve({ session: first.session });
    await openingFirst;
    await openingSecond;

    expect(pi.createManager.mock.calls.map(([cwd]) => cwd)).toEqual(["/first", "/second"]);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(service.snapshot()).toMatchObject({ opened: true, sessionId: "second" });
  });

  it("treats reopening the active session path as a no-op", async () => {
    const current = sessionDouble("current", true);
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", current.session.sessionFile);

    await expect(service.open("/workspace", current.session.sessionFile)).resolves.toMatchObject({ opened: true, sessionId: "current", running: true });

    expect(pi.createAgentSession).toHaveBeenCalledOnce();
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(current.abort).not.toHaveBeenCalled();
    expect(current.dispose).not.toHaveBeenCalled();
  });

  it("closes the current session once across repeated close calls", async () => {
    const current = sessionDouble("current", true);
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await Promise.all([service.close(), service.close()]);
    await service.close();

    expect(current.unsubscribe).toHaveBeenCalledOnce();
    expect(current.abort).toHaveBeenCalledOnce();
    expect(current.dispose).toHaveBeenCalledOnce();
    expect(service.snapshot()).toEqual({ opened: false, messages: [], running: false });
  });

  it("serializes model changes with session replacement", async () => {
    const changingModel = deferred<void>();
    const first = sessionDouble("first");
    first.session.setModel.mockImplementationOnce(() => changingModel.promise);
    const second = sessionDouble("second");
    pi.createRuntime.mockResolvedValueOnce({
      getAvailableSnapshot: () => [],
      getModel: () => ({ provider: "test", id: "next-model", name: "Next Model" }),
      completeSimple: pi.completeSimple,
    });
    pi.createAgentSession.mockResolvedValueOnce({ session: first.session }).mockResolvedValueOnce({ session: second.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    const modelChange = service.setModel("test", "next-model");
    const replacement = service.open("/next", undefined, undefined, true);
    await vi.waitFor(() => expect(first.session.setModel).toHaveBeenCalledOnce());
    expect(pi.createAgentSession).toHaveBeenCalledTimes(1);

    changingModel.resolve();
    await modelChange;
    await replacement;
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("does not publish synchronous subscription events before ownership commits", async () => {
    const candidate = sessionDouble("candidate");
    candidate.session.subscribe.mockImplementationOnce((listener: (event: { type: string }) => void) => {
      listener({ type: "agent_start" });
      return candidate.unsubscribe;
    });
    pi.createAgentSession.mockResolvedValueOnce({ session: candidate.session });
    const events = vi.fn();
    const service = new PiSessionService();
    service.onEvent(events);

    await service.open("/workspace", undefined, undefined, true);

    expect(events).not.toHaveBeenCalled();
  });

  it("uses the selected model to assign a semantic name after the first completed turn", async () => {
    const current = sessionDouble("current");
    pi.completeSimple.mockResolvedValueOnce(assistantText("Record terminal shell setup"));
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await service.send("Can the record terminal skill use the current login shell?");

    expect(pi.completeSimple).toHaveBeenCalledOnce();
    expect(pi.completeSimple.mock.calls[0]?.[0]).toBe(current.session.model);
    expect(pi.completeSimple.mock.calls[0]?.[1]).toMatchObject({
      messages: [{ role: "user", content: expect.stringContaining("record terminal skill") }],
    });
    expect(current.session.setSessionName).toHaveBeenCalledWith("Record terminal shell setup");
  });

  it("requests a semantic title only for the first turn", async () => {
    const current = sessionDouble("current");
    pi.completeSimple.mockResolvedValueOnce(assistantText("First title"));
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await service.send("First request");
    await service.send("Follow-up request");

    expect(pi.completeSimple).toHaveBeenCalledOnce();
    expect(current.session.setSessionName).toHaveBeenCalledOnce();
  });

  it("does not replace an explicit session name", async () => {
    const current = sessionDouble("current", false, "Pinned name");
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await service.send("First request");

    expect(pi.completeSimple).not.toHaveBeenCalled();
    expect(current.session.setSessionName).not.toHaveBeenCalled();
  });

  it("does not replace an explicit name assigned during the first turn", async () => {
    const current = sessionDouble("current");
    current.session.prompt.mockImplementationOnce(async (text: string) => {
      current.messages.push({ role: "user", content: text });
      current.session.sessionName = "Named by extension";
    });
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await service.send("First request");

    expect(pi.completeSimple).not.toHaveBeenCalled();
    expect(current.session.setSessionName).not.toHaveBeenCalled();
  });

  it("keeps a completed turn successful when semantic title generation fails", async () => {
    const current = sessionDouble("current");
    pi.completeSimple.mockRejectedValueOnce(new Error("title call failed"));
    pi.createAgentSession.mockResolvedValueOnce({ session: current.session });
    const service = new PiSessionService();
    await service.open("/workspace", undefined, undefined, true);

    await expect(service.send("First request")).resolves.toBeUndefined();
    expect(current.session.setSessionName).not.toHaveBeenCalled();
  });

  it("disposes a candidate whose subscription setup fails", async () => {
    const candidate = sessionDouble("candidate");
    candidate.session.subscribe.mockImplementationOnce(() => {
      throw new Error("subscribe failed");
    });
    pi.createAgentSession.mockResolvedValueOnce({ session: candidate.session });
    const service = new PiSessionService();

    await expect(service.open("/workspace", undefined, undefined, true)).rejects.toThrow("subscribe failed");

    expect(candidate.abort).toHaveBeenCalledOnce();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(service.snapshot()).toEqual({ opened: false, messages: [], running: false });
  });
});

function sessionDouble(sessionId: string, isStreaming = false, sessionName?: string) {
  let subscribed: ((event: { type: string }) => void) | undefined;
  const messages: Array<{ role: "user"; content: string }> = [];
  const unsubscribe = vi.fn();
  const abort = vi.fn(async () => {});
  const dispose = vi.fn();
  const session = {
    sessionId,
    sessionFile: `/sessions/${sessionId}.jsonl`,
    messages,
    isStreaming,
    model: { provider: "test", id: "test-model", name: "Test Model" },
    sessionName,
    subscribe: vi.fn((listener: (event: { type: string }) => void) => {
      subscribed = listener;
      return unsubscribe;
    }),
    prompt: vi.fn(async (text: string) => {
      messages.push({ role: "user", content: text });
    }),
    abort,
    dispose,
    setModel: vi.fn(async () => {}),
    setSessionName: vi.fn(),
  };
  return {
    session,
    messages,
    unsubscribe,
    abort,
    dispose,
    listener: () => {
      if (!subscribed) throw new Error("session was not subscribed");
      return subscribed;
    },
  };
}

function assistantText(text: string) {
  return { content: [{ type: "text", text }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
