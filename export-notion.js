const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const path = require("path");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const n2m = new NotionToMarkdown({ notionClient: notion });

const ROOT_PAGE_ID = process.env.NOTION_PAGE_ID;

async function exportPage(pageId, outDir = "docs") {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const filePath = path.join(outDir, `${pageId}.md`);
  fs.writeFileSync(filePath, mdString.parent || "", "utf8");

  const children = await notion.blocks.children.list({
    block_id: pageId,
  });

  for (const block of children.results) {
    if (block.type === "child_page") {
      await exportPage(block.id, outDir);
    }
  }
}

async function main() {
  if (!ROOT_PAGE_ID) {
    throw new Error("Missing NOTION_PAGE_ID");
  }

  await exportPage(ROOT_PAGE_ID, "docs");
  console.log("Notion export complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
