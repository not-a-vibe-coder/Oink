const checkEnvironment = { ...process.env };
delete checkEnvironment.DATABASE_URL;
delete checkEnvironment.TEST_DATABASE_URL;
async function run(cmd: string[], cwd = process.cwd(), env = checkEnvironment) {
  const child = Bun.spawn(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`Verification failed: ${cmd.join(" ")}`);
}
await run(["bunx", "tsc", "--noEmit"]);
await run(["bun", "run", "check"], `${process.cwd()}/backend`);
await run([
  "bunx",
  "eslint",
  "src/components/bell",
  "src/lib/bell",
  "src/lib/demo",
  "src/lib/flow",
  "src/routes/app.income.tsx",
  "src/routes/income.$invoiceId.tsx",
  "src/routes/demo.tsx",
]);
await run(["bun", "test"]);
if (process.env.TEST_DATABASE_URL) {
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  for (const file of [
    "flow.integration.test.ts",
    "bell-quotes.integration.test.ts",
    "bell-execution.integration.test.ts",
  ]) {
    await run(["bun", "test", `backend/tests/${file}`], process.cwd(), env);
  }
} else
  console.log("Database integration checks not run: configure a disposable TEST_DATABASE_URL.");
await run(["bun", "run", "build"]);
