const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const ROOT_ID = process.env.NOTION_PAGE_ID;

// ─── Rate limiting ────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function rl() { await sleep(350); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanFileName(name) {
  return String(name || "untitled")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function titleFromPage(page) {
  if (!page?.properties) return "untitled";
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title?.length) {
      return prop.title.map(t => t.plain_text).join("").trim() || "untitled";
    }
  }
  return "untitled";
}

function titleFromDatabase(db) {
  return db?.title?.map(t => t.plain_text).join("").trim() || "untitled";
}

// ─── Retrieve anything: returns { type: "page"|"database", obj } ──────────────
async function retrieve(id) {
  await rl();
  try {
    const obj = await notion.pages.retrieve({ page_id: id });
    return { type: "page", obj };
  } catch (e) {
    if (e?.message?.includes("database")) {
      await rl();
      const obj = await notion.databases.retrieve({ database_id: id });
      return { type: "database", obj };
    }
    throw e;
  }
}

// ─── Get all results from a database ─────────────────────────────────────────
async function queryDatabase(databaseId) {
  let results = [], cursor;
  while (true) {
    await rl();
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ─── Get child blocks (pages + databases) ────────────────────────────────────
async function getChildBlocks(blockId) {
  let results = [], cursor;
  while (true) {
    await rl();
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results.filter(b => b.type === "child_page" || b.type === "child_database"));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ─── Export markdown for a page ───────────────────────────────────────────────
async function writePageMarkdown(pageId, dir, label) {
  await rl();
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);
  const content = mdString.parent || "";
  if (!content.trim()) {
    console.warn(`  ⚠ Empty content: ${label}`);
  }
  fs.writeFileSync(path.join(dir, "index.md"), content, "utf8");
}

// ─── Main recursive export ────────────────────────────────────────────────────
// Handles any id — detects page vs database automatically
async function exportAny(id, outDir, visited, isRoot = false) {
  if (visited.has(id)) return;
  visited.add(id);

  const { type, obj } = await retrieve(id);

  if (type === "database") {
    await exportDatabase(id, obj, outDir, visited, isRoot);
  } else {
    await exportPage(id, obj, outDir, visited);
  }
}

async function exportDatabase(id, obj, outDir, visited, isRoot = false) {
  const title = titleFromDatabase(obj);
  const dir = isRoot ? outDir : path.join(outDir, cleanFileName(title));
  fs.mkdirSync(dir, { recursive: true });

  if (isRoot) {
    console.log(`\n📂 Root database: "${title}"`);
  } else {
    console.log(`  📂 Database: "${title}" → ${dir}`);
  }

  // Each "row" in the database might itself be a page OR another database
  const rows = await queryDatabase(id);
  for (const row of rows) {
    // Don't use visited check here — retrieve() will handle it
    // Each row: try to determine if it's actually a database disguised as a page
    await exportAny(row.id, dir, visited, false);
  }
}

async function exportPage(id, obj, outDir, visited) {
  const title = titleFromPage(obj);

  if (title === "untitled") {
    console.warn(`  ⚠ Skipping untitled page (${id})`);
    return;
  }

  const dir = path.join(outDir, cleanFileName(title));
  fs.mkdirSync(dir, { recursive: true });

  await writePageMarkdown(id, dir, title);
  console.log(`  ✓ Page: "${title}" → ${dir}/index.md`);

  // Check for child pages/databases inside this page
  const blocks = await getChildBlocks(id);
  for (const block of blocks) {
    await exportAny(block.id, dir, visited, false);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  if (!ROOT_ID) throw new Error("Missing NOTION_PAGE_ID");
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");

  if (fs.existsSync("docs")) fs.rmSync("docs", { recursive: true, force: true });
  fs.mkdirSync("docs", { recursive: true });

  console.log(`🚀 Starting export from: ${ROOT_ID}`);
  const visited = new Set();
  await exportAny(ROOT_ID, "docs", visited, true);
  console.log("\n✅ Export complete");
}

main().catch(err => {
  console.error("\n❌ Export failed:", err.message);
  console.error(err);
  process.exit(1);
});
