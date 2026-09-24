import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function adHocSignInvocation(context, environment = process.env) {
  if (environment.APPLE_PI_ADHOC_RESIGN !== "1" || context.electronPlatformName !== "darwin") return null;
  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) throw new Error("Cannot ad-hoc sign macOS package: Electron Builder did not provide the product filename");
  return {
    command: "codesign",
    args: ["--force", "--deep", "--sign", "-", path.join(context.appOutDir, `${productFilename}.app`)],
  };
}

export default async function resignMacosAdHoc(context) {
  const invocation = adHocSignInvocation(context);
  if (!invocation) return;
  // Electron Builder preserves upstream signatures on some nested frameworks
  // while ad-hoc signing the outer app. macOS then refuses to map those
  // different Team IDs into one process. This local-only pass gives the whole
  // bundle one consistent ad-hoc identity; release signing never sets the flag.
  await execFileAsync(invocation.command, invocation.args);
}
