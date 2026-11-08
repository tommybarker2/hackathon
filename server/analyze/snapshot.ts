import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  detectLang,
  isIgnoredRepoPath,
  MAX_FILE_BYTES,
  type SourceFile,
} from "./walk";

const run = promisify(execFile);

const MAX_SNAPSHOT_FILES = 900;
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

export interface SnapshotCommit {
  sha: string;
  short: string;
  subject: string;
  date: string;
  author: string;
}

interface TreeEntry {
  path: string;
  oid: string;
  size: number;
}

export async function resolveCommit(root: string, ref: string): Promise<SnapshotCommit> {
  const cleaned = ref.trim();
  if (!cleaned || cleaned.length > 200) {
    throw new Error("A commit reference is required.");
  }

  let sha: string;
  try {
    const { stdout } = await run(
      "git",
      ["-C", root, "rev-parse", "--verify", `${cleaned}^{commit}`],
      { maxBuffer: 1_000_000 },
    );
    sha = stdout.trim();
  } catch {
    throw new Error(`Could not resolve commit "${cleaned}" in this repository.`);
  }

  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new Error(`Git returned an invalid commit id for "${cleaned}".`);
  }

  try {
    const { stdout } = await run(
      "git",
      ["-C", root, "show", "-s", "--format=%h%x00%s%x00%ad%x00%an", "--date=short", sha],
      { maxBuffer: 1_000_000 },
    );
    const [short, subject, date, author] = stdout.trimEnd().split("\u0000");
    return {
      sha,
      short: short || sha.slice(0, 7),
      subject: subject || "(no subject)",
      date: date || "",
      author: author || "unknown",
    };
  } catch {
    return { sha, short: sha.slice(0, 7), subject: "(no subject)", date: "", author: "unknown" };
  }
}

async function listTree(root: string, sha: string): Promise<TreeEntry[]> {
  const { stdout } = await run("git", ["-C", root, "ls-tree", "-r", "-z", "-l", sha], {
    maxBuffer: MAX_GIT_OUTPUT,
  });

  const entries: TreeEntry[] = [];
  for (const record of stdout.split("\u0000")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const meta = record.slice(0, tab).trim().split(/\s+/);
    const type = meta[1];
    const oid = meta[2];
    const size = Number(meta[3]);
    const filePath = record.slice(tab + 1);
    if (type !== "blob" || !oid || !filePath) continue;
    if (!Number.isFinite(size) || size < 0) continue;
    entries.push({ path: filePath, oid, size });
  }
  return entries;
}

function readObjects(root: string, oids: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, "cat-file", "--batch"], { windowsHide: true });
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let stderr = "";

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };

    child.on("error", fail);
    child.stdout?.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_GIT_OUTPUT) {
        fail(new Error("This commit is too large to read in one analysis."));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git cat-file exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(oids.join("\n") + "\n");
  });
}

async function readContents(root: string, entries: TreeEntry[]): Promise<(string | null)[]> {
  const output = await readObjects(
    root,
    entries.map((entry) => entry.oid),
  );
  const contents: (string | null)[] = [];
  let offset = 0;

  for (const _entry of entries) {
    const newline = output.indexOf(10, offset);
    if (newline === -1) break;
    const header = output.subarray(offset, newline).toString("ascii");
    offset = newline + 1;
    const parts = header.split(" ");
    if (parts[1] === "missing") {
      contents.push(null);
      continue;
    }
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0 || offset + size > output.length) break;
    const body = output.subarray(offset, offset + size);
    offset += size;
    if (output[offset] === 10) offset += 1;
    contents.push(body.includes(0) ? null : body.toString("utf8"));
  }

  return contents;
}

export async function loadLocalSnapshot(
  root: string,
  ref: string,
): Promise<{ files: SourceFile[]; truncated: boolean; commit: SnapshotCommit }> {
  const commit = await resolveCommit(root, ref);
  const tree = await listTree(root, commit.sha);
  const selected: TreeEntry[] = [];
  let bytes = 0;
  let truncated = false;

  for (const entry of tree) {
    if (isIgnoredRepoPath(entry.path)) continue;
    if (detectLang(entry.path) === "other") continue;
    if (entry.size > MAX_FILE_BYTES) {
      truncated = true;
      continue;
    }
    if (selected.length >= MAX_SNAPSHOT_FILES || bytes + entry.size > MAX_SNAPSHOT_BYTES) {
      truncated = true;
      continue;
    }
    selected.push(entry);
    bytes += entry.size;
  }

  const contents = await readContents(root, selected);
  const files: SourceFile[] = [];
  for (let i = 0; i < selected.length; i++) {
    const content = contents[i];
    if (content === undefined || content === null) continue;
    const entry = selected[i];
    files.push({
      path: entry.path,
      content,
      lang: detectLang(entry.path),
      size: entry.size,
    });
  }

  return { files, truncated, commit };
}