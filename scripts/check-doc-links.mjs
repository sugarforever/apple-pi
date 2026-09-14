import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const roots = ["README.md", "docs"];
const markdownFiles = [];

async function collect(path) {
  if (extname(path) === ".md") {
    markdownFiles.push(path);
    return;
  }

  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await collect(child);
    else if (entry.isFile() && extname(entry.name) === ".md") markdownFiles.push(child);
  }
}

for (const root of roots) await collect(root);

const failures = [];
for (const file of markdownFiles) {
  const contents = await readFile(file, "utf8");
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    try {
      await access(resolve(dirname(file), decodeURI(target)));
    } catch {
      failures.push(`${file}: missing local link ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files; all local links resolve.`);
}
