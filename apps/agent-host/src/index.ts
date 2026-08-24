import { encodeRecord, JsonlDecoder } from "@apple-pi/protocol";
import { HostServer } from "./server.js";

const server = new HostServer((event) => process.stdout.write(encodeRecord(event)));
const decoder = new JsonlDecoder();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const message of decoder.push(chunk)) {
    void server.handle(message).then((response) => process.stdout.write(encodeRecord(response)));
  }
});
