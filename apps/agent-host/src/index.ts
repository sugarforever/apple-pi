import { encodeRecord, JsonlDecoder } from "@apple-pi/protocol";
import { dispatchHostMessage } from "./host-process.js";
import { HostServer } from "./server.js";

const server = new HostServer((event) => process.stdout.write(encodeRecord(event)));
const decoder = new JsonlDecoder();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const message of decoder.push(chunk)) {
    void dispatchHostMessage(
      server,
      message,
      (response) =>
        new Promise<void>((resolve, reject) => {
          process.stdout.write(encodeRecord(response), (error) => (error ? reject(error) : resolve()));
        }),
      () => process.exit(0),
    );
  }
});
