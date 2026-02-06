import { spawn } from "child_process";

const child = spawn("npx", ["drizzle-kit", "push"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let output = "";

child.stdout.on("data", (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);

  if (text.includes("truncate")) {
    setTimeout(() => {
      child.stdin.write("\n");
    }, 200);
  }
});

child.stderr.on("data", (data) => {
  process.stderr.write(data);
});

child.on("close", (code) => {
  if (output.includes("DROP") || output.includes("TRUNCATE")) {
    console.error("\n[db-push-safe] BLOCKED: Detected destructive statement in output. Aborting.");
    process.exit(1);
  }
  process.exit(code);
});
