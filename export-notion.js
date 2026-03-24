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

// Get title safely
function getTitle(block) {
  if (block.child_page) return block.child_page.title;
  return "untitled";
}

// Recursively traverse pages
async function traverse(pageId, folder = "docs") {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);

  // Get page info
  const page = await notion.pages.retrieve({ page_id: pageId });
  const title =
    page.properties?.title?.title[0]?.plain_text || "untitled";

  const fileName = cleanFileName(title) + ".md";

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const filePath = path.join(folder, fileName);
  fs.writeFileSync(filePath, mdString.parent || "", "utf8");

  console.log(`Exported: ${fileName}`);

  // Get children blocks
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });

    for (const block of response.results) {
      if (block.type === "child_page") {
        await traverse(block.id, folder);
      }
    }

    hasMore = response.has_more;
    cursor = response.next_cursor;
  }
}

async function main() {
  // 🔥 Force clean docs folder (fix "everything up-to-date")
  if (fs.existsSync("docs")) {
    fs.rmSync("docs", { recursive: true, force: true });
  }

  fs.mkdirSync("docs", { recursive: true });

  await traverse(ROOT_PAGE_ID);

  console.log("Full export complete");
}

main().catch(console.error);
