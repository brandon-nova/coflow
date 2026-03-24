const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const path = require("path");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});
const n2m = new NotionToMarkdown({ notionClient: notion });
const ROOT_PAGE_ID = process.env.NOTION_PAGE_ID;

// ─── Rate limiting ────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimit() {
  await sleep(350);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanFileName(name) {
  return String(name || "untitled")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function getPageTitleFromPageObject(page) {
  if (!page || !page.properties) return "untitled";
  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (prop && prop.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((t) => t.plain_text).join("").trim() || "untitled";
    }
  }
  return "untitled";
}

async function getPageTitle(pageId) {
  await rateLimit();
  const page = await notion.pages.retrieve({ page_id: pageId });
  return getPageTitleFromPageObject(page);
}

// ─── Child block fetching (pages + databases) ─────────────────────────────────
async function getChildBlocks(blockId) {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    await rateLimit();
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    const children = response.results.filter(
      (b) => b.type === "child_page" || b.type === "child_database"
    );
    results.push(...children);

    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return results;
}

// ─── Database handling ────────────────────────────────────────────────────────
async function getDatabaseTitle(databaseId) {
  await rateLimit();
  const db = await notion.databases.retrieve({ database_id: databaseId });
  if (db.title && db.title.length > 0) {
    return db.title.map((t) => t.plain_text).join("").trim() || "untitled-db";
  }
  return "untitled-db";
}

async function getDatabasePages(databaseId) {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    await rateLimit();
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    results.push(...response.results);
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return results;
}

// ─── Core export ──────────────────────────────────────────────────────────────
async function exportPage(pageId, outDir, visited) {
  if (visited.has(pageId)) return;
  visited.add(pageId);

  const title = await getPageTitle(pageId);
  const folderName = cleanFileName(title);
  const pageDir = path.join(outDir, folderName);
  fs.mkdirSync(pageDir, { recursive: true });

  await rateLimit();
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);
  const content = mdString.parent || "";

  if (!content.trim()) {
    console.warn(`  ⚠ Empty export for page: "${title}" (${pageId})`);
  }

  fs.writeFileSync(path.join(pageDir, "index.md"), content, "utf8");
  console.log(`✓ Page: ${pageDir}/index.md`);

  const children = await getChildBlocks(pageId);
  for (const child of children) {
    if (child.type === "child_page") {
      await exportPage(child.id, pageDir, visited);
    } else if (child.type === "child_database") {
      await exportDatabase(child.id, pageDir, visited, false);
    }
  }
}

async function exportDatabase(databaseId, outDir, visited, isRoot = false) {
  if (visited.has(databaseId)) return;
  visited.add(databaseId);

  // Root-level database: export pages directly into outDir, no wrapping folder.
  // Nested database: create a named subfolder.
  let dbDir;
  if (isRoot) {
    dbDir = outDir;
    console.log(`✓ Root database → exporting pages directly into ${dbDir}/\n`);
  } else {
    const title = await getDatabaseTitle(databaseId);
    const folderName = cleanFileName(title);
    dbDir = path.join(outDir, folderName);
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✓ Database: ${dbDir}/`);
  }

  const pages = await getDatabasePages(databaseId);
  for (const page of pages) {
    if (visited.has(page.id)) continue;
    visited.add(page.id);

    const pageTitle = getPageTitleFromPageObject(page);

    // Skip untitled placeholder rows
    if (pageTitle === "untitled") {
      console.warn(`  ⚠ Skipping untitled db entry (${page.id}) — likely an empty row`);
      continue;
    }

    const folderName = cleanFileName(pageTitle);
    const pageDir = path.join(dbDir, folderName);
    fs.mkdirSync(pageDir, { recursive: true });

    await rateLimit();
    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdBlocks);
    const content = mdString.parent || "";

    if (!content.trim()) {
      console.warn(`  ⚠ Empty content for db page: "${pageTitle}" (${page.id})`);
    }

    fs.writeFileSync(path.join(pageDir, "index.md"), content, "utf8");
    console.log(`  ✓ DB page: ${pageDir}/index.md`);

    const children = await getChildBlocks(page.id);
    for (const child of children) {
      if (child.type === "child_page") {
        await exportPage(child.id, pageDir, visited);
      } else if (child.type === "child_database") {
        await exportDatabase(child.id, pageDir, visited, false);
      }
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  if (!ROOT_PAGE_ID) throw new Error("Missing NOTION_PAGE_ID env variable");
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN env variable");

  if (fs.existsSync("docs")) {
    fs.rmSync("docs", { recursive: true, force: true });
  }
  fs.mkdirSync("docs", { recursive: true });

  // Auto-detect whether root ID is a page or a database
  await rateLimit();
  const rootObject = await notion.pages.retrieve({ page_id: ROOT_PAGE_ID }).catch(async (err) => {
    if (err?.code === "validation_error" && err?.message?.includes("database")) {
      return { object: "database", id: ROOT_PAGE_ID };
    }
    throw err;
  });

  console.log(`Starting export from root ${rootObject.object}: ${ROOT_PAGE_ID}\n`);

  const visited = new Set();

  if (rootObject.object === "database") {
    await exportDatabase(ROOT_PAGE_ID, "docs", visited, true);
  } else {
    await exportPage(ROOT_PAGE_ID, "docs", visited);
  }

  console.log("\n✅ Full export complete");
}

main().catch((err) => {
  console.error("\n❌ Export failed:");
  console.error(err);
  process.exit(1);
});
