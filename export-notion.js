const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const path = require("path");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const n2m = new NotionToMarkdown({ notionClient: notion });

const ROOT_PAGE_ID = process.env.NOTION_PAGE_ID;

// Clean filename
function cleanFileName(name) {
  return name
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

// Get page title
function getPageTitle(page) {
  return page.properties?.title?.title[0]?.plain_text || "untitled";
}

// Get all pages in workspace
async function getAllPages() {
  let results = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const response = await notion.search({
      start_cursor: cursor,
      filter: { property: "object", value: "page" },
      page_size: 100,
    });

    results = results.concat(response.results);
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return results;
}

// Check if page is under root
function isChildOfRoot(page) {
  return page.parent?.page_id === ROOT_PAGE_ID;
}

async function exportPage(page) {
  const pageId = page.id;
  const title = getPageTitle(page);
  const fileName = cleanFileName(title) + ".md";

  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);

  const filePath = path.join("docs", fileName);
  fs.writeFileSync(filePath, mdString.parent || "", "utf8");

  console.log(`Exported: ${fileName}`);
}

async function main() {
  if (!fs.existsSync("docs")) {
    fs.mkdirSync("docs", { recursive: true });
  }

  const pages = await getAllPages();

  // Export root page
  const rootPage = pages.find(p => p.id === ROOT_PAGE_ID);
  if (rootPage) {
    await exportPage(rootPage);
  }

  // Export children
  for (const page of pages) {
    if (isChildOfRoot(page)) {
      await exportPage(page);
    }
  }

  console.log("Export complete");
}

main().catch(console.error);
