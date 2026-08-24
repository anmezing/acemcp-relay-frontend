#!/usr/bin/env node
import { spawn } from "node:child_process";

const nextBin = process.platform === "win32" ? "next.cmd" : "next";
const args = ["build"];

// Turbopack currently creates pnpm dependency symlinks during Windows builds
// and aborts when Developer Mode is unavailable. Webpack has the same runtime
// output but does not require that privileged preparation step. Standalone
// tracing is independently disabled by next.config.ts on Windows.
if (process.platform === "win32") args.push("--webpack");

const child = spawn(nextBin, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  // Windows exposes package-manager command shims as .cmd files. The command
  // and arguments are constants, so shell resolution is bounded to this
  // launcher and does not interpolate user input.
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  process.stderr.write(`Unable to start Next.js build: ${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Next.js build terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
