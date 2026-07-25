import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
let commit = process.env.DEVSPACE_RUNTIME_COMMIT;
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }
}
const info = {
  version: packageJson.version,
  commit,
  builtAt: new Date().toISOString(),
};
writeFileSync(new URL("../build-info.json", import.meta.url), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build info: ${info.version} ${info.commit}`);
