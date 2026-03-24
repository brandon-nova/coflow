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

async function getDatabaseTitle(databaseId) {
  await rateLimit();
  const db = await notion.databases.retrieve({ database_id: databaseId });
  if (db.title && db.title.length > 0) {
    return db.title.map((t) => t.plain_text).join("").trim() || "untitled-db";
  }
  return "untitled-db";
}

// ─── Fetch ALL child blocks (pages + databases) under a block ─────────────────
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
    results.push(...response.results);
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return results;
}

// ─── Fetch child databases whose parent is a given page (via search) ──────────
// This catches databases that are children of a page but don't appear
// as simple child_database blocks (common with full-page databases in Notion).
async function getChildDatabases(pageId) {
  let results = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    await rateLimit();
    const response = await notion.search({
      filter: { object: "database" },
      start_cursor: cursor,
      page_size: 100,
    });

    const children = response.results.filter(
      (db) => db.parent?.type === "page_id" && db.parent?.page_id?.replace(/-/g, "") === pageId.replace(/-/g, "")
    );
    results.push(...children);

    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return results;
}

// ─── Fetch all pages inside a database ───────────────────────────────────────
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

  // 1. Handle child_page and inline child_database blocks
  const blocks = await getChildBlocks(pageId);
  for (const block of blocks) {
    if (block.type === "child_page") {
      await exportPage(block.id, pageDir, visited);
    } else if (block.type === "child_database") {
      await exportDatabase(block.id, pageDir, visited, false);
    }
  }

  // 2. Handle full-page child databases (parented to this page, not inline blocks)
  const childDbs = await getChildDatabases(pageId);
  for (const db of childDbs) {
    await exportDatabase(db.id, pageDir, visited, false);
  }
}

async function exportDatabase(databaseId, outDir, visited, isRoot = false) {
  if (visited.has(databaseId)) return;
  visited.add(databaseId);

  let dbDir;
  if (isRoot) {
    dbDir = outDir;
    console.log(`✓ Root database → exporting pages into ${dbDir}/\n`);
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

    if (pageTitle === "untitled") {
      console.warn(`  ⚠ Skipping untitled db entry (${page.id})`);
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

    // 1. Inline child blocks (child_page, child_database)
    const blocks = await getChildBlocks(page.id);
    for (const block of blocks) {
      if (block.type === "child_page") {
        await exportPage(block.id, pageDir, visited);
      } else if (block.type === "child_database") {
        await exportDatabase(block.id, pageDir, visited, false);
      }
    }

    // 2. Full-page child databases parented to this page
    const childDbs = await getChildDatabases(page.id);
    for (const db of childDbs) {
      await exportDatabase(db.id, pageDir, visited, false);
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
