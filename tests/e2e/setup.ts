/**
 * Playwright global setup: writes the fixture data to .e2e/build and builds
 * the site from it into .e2e/site (the real `npm run site:build` output in
 * _site is left alone and smoke-tested separately).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blob, health, history } from "./fixture.ts";

export default function setup(): void {
  const root = join(process.cwd(), ".e2e");
  const build = join(root, "build");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "events.json"), JSON.stringify(blob));
  writeFileSync(join(build, "health.json"), JSON.stringify(health));
  writeFileSync(join(build, "history.json"), JSON.stringify(history));
  execFileSync("npx", ["eleventy", "--quiet", `--output=${join(root, "site")}`], {
    stdio: "inherit",
    env: { ...process.env, BUILD_DIR: build },
  });
}
