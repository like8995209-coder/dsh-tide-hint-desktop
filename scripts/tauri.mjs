import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = join(
  projectRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

if (!existsSync(tauriCli)) {
  console.error("[tauri] 缺少依赖，请先运行 npm install。");
  process.exit(1);
}

const env = { ...process.env };

function prependPath(directory) {
  const current = env.PATH ?? "";
  const entries = current.split(delimiter).filter(Boolean);
  if (!entries.some((entry) => entry.toLowerCase() === directory.toLowerCase())) {
    env.PATH = [directory, current].filter(Boolean).join(delimiter);
  }
}

prependPath(dirname(process.execPath));

function executableNames(name) {
  if (process.platform !== "win32" || /\.(exe|cmd|bat)$/i.test(name)) {
    return [name];
  }
  const extensions = (env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .filter(Boolean);
  return [name, ...extensions.map((extension) => `${name}${extension}`)];
}

function findOnPath(name) {
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const executable of executableNames(name)) {
      const candidate = join(directory, executable);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function childDirectories(parent) {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  } catch {
    return [];
  }
}

function findLlvmMingwBin() {
  const explicit = env.TAURI_MINGW_BIN?.trim();
  if (explicit) {
    const clang = join(
      explicit,
      process.arch === "ia32"
        ? "i686-w64-mingw32-clang.exe"
        : "x86_64-w64-mingw32-clang.exe",
    );
    if (existsSync(clang)) return explicit;
  }

  const onPath = findOnPath(
    process.arch === "ia32"
      ? "i686-w64-mingw32-clang"
      : "x86_64-w64-mingw32-clang",
  );
  if (onPath) return dirname(onPath);

  const roots = [];
  let cursor = projectRoot;
  for (let depth = 0; depth < 4; depth += 1) {
    roots.push(join(cursor, ".tools", "llvm-mingw", "toolchain"));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  roots.push(join(homedir(), ".tools", "llvm-mingw", "toolchain"));

  const clangName =
    process.arch === "ia32"
      ? "i686-w64-mingw32-clang.exe"
      : "x86_64-w64-mingw32-clang.exe";
  for (const root of roots) {
    for (const toolchain of childDirectories(root)) {
      const bin = join(toolchain, "bin");
      if (existsSync(join(bin, clangName))) return bin;
    }
  }
  return null;
}

const rustupHome = env.RUSTUP_HOME ?? join(homedir(), ".rustup");
const cargoBin = env.CARGO_HOME
  ? join(env.CARGO_HOME, "bin")
  : join(homedir(), ".cargo", "bin");
if (!findOnPath("cargo") && existsSync(cargoBin)) prependPath(cargoBin);

const explicitToolchain = env.RUSTUP_TOOLCHAIN?.trim();
const hasMsvcCompiler = Boolean(findOnPath("cl") || findOnPath("cl.exe"));
const mingwBin = findLlvmMingwBin();
const gnuToolchain = join(
  rustupHome,
  "toolchains",
  "stable-x86_64-pc-windows-gnu",
);

// Windows 默认使用系统 MSVC。若当前终端没有 MSVC 编译器，但本机已有
// llvm-mingw 与 Rust GNU 工具链，则自动切换到可直接运行的 GNU 构建。
if (
  process.platform === "win32" &&
  !explicitToolchain &&
  !env.CARGO_BUILD_TARGET &&
  !hasMsvcCompiler &&
  mingwBin &&
  existsSync(join(gnuToolchain, "bin", "rustc.exe"))
) {
  const suffix = process.arch === "ia32" ? "i686" : "x86_64";
  const clang = join(mingwBin, `${suffix}-w64-mingw32-clang.exe`);
  const clangxx = join(mingwBin, `${suffix}-w64-mingw32-clang++.exe`);
  const ar = join(mingwBin, "llvm-ar.exe");
  const mingwRoot = dirname(dirname(dirname(mingwBin)));
  const compatBin = join(mingwRoot, "compat-bin");
  const compatLib = join(mingwRoot, "compat-lib");
  const dlltool = existsSync(join(compatBin, "dlltool.exe"))
    ? join(compatBin, "dlltool.exe")
    : join(mingwBin, "dlltool.exe");
  const windres = join(mingwBin, "windres.exe");
  const target =
    process.arch === "ia32"
      ? "i686-pc-windows-gnu"
      : "x86_64-pc-windows-gnu";
  const targetEnv = `CARGO_TARGET_${target.toUpperCase().replaceAll("-", "_")}`;

  env.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu";
  env.CARGO_BUILD_TARGET = target;
  env.CC = clang;
  env.CXX = clangxx;
  env.AR = ar;
  env.DLLTOOL = dlltool;
  env.WINDRES = windres;
  env[`${targetEnv}_LINKER`] = clang;
  env[`${targetEnv}_AR`] = ar;
  prependPath(mingwBin);
  if (existsSync(compatBin)) prependPath(compatBin);
  if (existsSync(compatLib)) {
    env.LIBRARY_PATH = [compatLib, env.LIBRARY_PATH]
      .filter(Boolean)
      .join(delimiter);
  }
  console.log(`[tauri] 使用 Windows GNU 工具链：${mingwBin}`);
}

const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`[tauri] 启动失败：${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
