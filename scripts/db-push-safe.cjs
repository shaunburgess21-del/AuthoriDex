const { spawn } = require("node:child_process");

const useShell = process.platform === "win32";
const command = useShell ? "npx drizzle-kit push" : "npx";
const args = useShell ? [] : ["drizzle-kit", "push"];

let outputBuffer = "";
let promptCount = 0;

function handleChunk(chunk, stream) {
  const text = chunk.toString();
  stream.write(text);
  outputBuffer = `${outputBuffer}${text}`.slice(-4000);

  if (!outputBuffer.includes("Do you want to truncate")) {
    return;
  }

  if (promptCount > 0 && outputBuffer.includes(`Auto-selecting the safe default for prompt #${promptCount}`)) {
    return;
  }

  promptCount += 1;
  process.stdout.write(
    `\n[db:push] Auto-selecting the safe default for prompt #${promptCount}: keep data and add the constraint without truncation.\n`
  );
  child.stdin.write("\r");
  outputBuffer = "";
}

const child = spawn(command, args, {
  stdio: ["pipe", "pipe", "pipe"],
  shell: useShell,
  env: process.env,
});

child.stdout.on("data", (chunk) => handleChunk(chunk, process.stdout));
child.stderr.on("data", (chunk) => handleChunk(chunk, process.stderr));

child.on("error", (error) => {
  process.stderr.write(`[db:push] Failed to start drizzle-kit: ${error.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
