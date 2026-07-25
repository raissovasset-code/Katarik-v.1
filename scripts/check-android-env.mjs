import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const checks = [
  {
    name: "Java",
    command: "java",
    args: ["-version"],
    fix: "Install JDK 17 or newer and restart the terminal.",
  },
  {
    name: "Android Debug Bridge",
    command: "adb",
    args: ["version"],
    fix: "Install Android Studio, then install Android SDK Platform-Tools.",
  },
];

let hasError = false;

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    stdio: "pipe",
  });

  if (result.status === 0) {
    console.log(`[ok] ${check.name}`);
  } else {
    hasError = true;
    console.log(`[missing] ${check.name}`);
    console.log(`  ${check.fix}`);
  }
}

const androidProject = join(process.cwd(), "android", "gradlew.bat");
if (existsSync(androidProject)) {
  console.log("[ok] Android project");
} else {
  hasError = true;
  console.log("[missing] Android project");
  console.log("  Run: npx cap add android");
}

if (hasError) {
  process.exitCode = 1;
  console.log("\nAndroid APK build is not ready on this computer yet.");
} else {
  console.log("\nAndroid APK build environment looks ready.");
}
