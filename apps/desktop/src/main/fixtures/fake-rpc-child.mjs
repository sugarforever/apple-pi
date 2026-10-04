// Stands in for `pi --mode rpc` in pi-process tests. Each command type maps to
// one behavior the process manager has to cope with.
import { createInterface } from "node:readline";

const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const respond = (command, data) => write({ id: command.id, type: "response", command: command.type, success: true, data });

createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  switch (command.type) {
    case "get_state":
      // Answer late, so a later command's response can overtake this one.
      setTimeout(() => respond(command, { sessionId: "fake" }), 50);
      break;
    case "get_messages":
      respond(command, { messages: [] });
      break;
    case "get_commands": {
      // A malformed line, then a response split across two writes.
      process.stdout.write("not json\n");
      const text = `${JSON.stringify({ id: command.id, type: "response", command: command.type, success: true, data: { commands: [] } })}\n`;
      process.stdout.write(text.slice(0, 10));
      setTimeout(() => process.stdout.write(text.slice(10)), 10);
      break;
    }
    case "prompt":
      respond(command, { disposition: "started" });
      write({ type: "agent_start" });
      break;
    case "bash":
      process.stderr.write("fake pi crashed\n");
      process.exit(3);
      break;
    case "abort":
      // Never answered.
      break;
  }
});
