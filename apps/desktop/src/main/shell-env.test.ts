import { expect, it } from "vitest";
import { parseShellEnv } from "./shell-env.js";

it("reads the environment between the marks and drops the probe's own variables", () => {
  const env = { PATH: "/opt/homebrew/bin:/usr/bin", ANTHROPIC_API_KEY: "k", MULTI: "a\nb", ELECTRON_RUN_AS_NODE: "1" };
  const output = `Welcome to zsh\n_APPLE_PI_SHELL_ENV_${JSON.stringify(env)}_APPLE_PI_SHELL_ENV_\nbye\n`;
  expect(parseShellEnv(output)).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin", ANTHROPIC_API_KEY: "k", MULTI: "a\nb" });
  expect(parseShellEnv("no marks here")).toEqual({});
});
