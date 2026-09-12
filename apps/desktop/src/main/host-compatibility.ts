import { PROTOCOL_VERSION, SUPPORTED_PI_VERSION, decodeCommandResult, type HostCommandResults } from "@apple-pi/protocol";

const requiredCapabilities = ["sessionEvents", "modelSelection"] as const;

function field(value: unknown, name: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;
}

export function validateHostHandshake(value: unknown, expectedHostVersion: string): HostCommandResults["system.hello"] {
  const protocolVersion = field(value, "protocolVersion");
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Incompatible agent host protocol: expected ${PROTOCOL_VERSION}, received ${String(protocolVersion)}`);
  }

  const hostVersion = field(value, "hostVersion");
  if (hostVersion !== expectedHostVersion) {
    throw new Error(`Incompatible agent host version: expected ${expectedHostVersion}, received ${String(hostVersion)}`);
  }

  const piVersion = field(value, "piVersion");
  if (typeof piVersion !== "string" || piVersion.length === 0) {
    throw new Error("Invalid agent host handshake: missing piVersion");
  }
  if (piVersion !== SUPPORTED_PI_VERSION) {
    throw new Error(`Incompatible Pi version: expected ${SUPPORTED_PI_VERSION}, received ${piVersion}`);
  }

  const capabilities = field(value, "capabilities");
  for (const capability of requiredCapabilities) {
    if (!capabilities || typeof capabilities !== "object" || (capabilities as Record<string, unknown>)[capability] !== true) {
      throw new Error(`Agent host is missing required capability: ${capability}`);
    }
  }

  try {
    return decodeCommandResult("system.hello", value);
  } catch (error) {
    throw new Error(`Invalid agent host handshake: ${error instanceof Error ? error.message : String(error)}`);
  }
}
