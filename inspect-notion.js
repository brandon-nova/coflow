const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ROOT_ID = process.env.NOTION_PAGE_ID;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function rl() { await sleep(350); }

async function inspect(id, depth = 0, visited = new Set()) {
  if (visited.has(id)) return;
  visited.add(id);
  const indent = "  ".repeat(depth);

  // Try as page first, then database
  let obj = null;
  let type = null;

  try {
    await rl();
    obj = await notion.pages.retrieve({ page_id: id });
    type = "page";
  } catch (e) {
    if (e?.message?.includes("database")) {
      try {
        await rl();
        obj = await notion.databases.retrieve({ database_id: id });
        type = "database";
      } catch (e2) {
        console.log(`${indent}❌ Could not retrieve ${id}: ${e2.message}`);
        return;
      }
    } else {
      console.log(`${indent}❌ Error retrieving ${id}: ${e.message}`);
      return;
    }
  }

  // Print what we found
  let title = "(no title)";
  if (type === "page" && obj.properties) {
    for (const key of Object.keys(obj.properties)) {
      const prop = obj.properties[key];
      if (prop.type === "title" && prop.title?.length) {
        title = prop.title.map(t => t.plain_text).join("").trim();
        break;
      }
    }
  } else if (type === "database" && obj.title?.length) {
    title = obj.title.map(t => t.plain_text).join("").trim();
  }

  const parentType = obj.parent?.type || "unknown";
  console.log(`${indent}[${type.toUpperCase()}] "${title || "(untitled)"}"`);
  console.log(`${indent}  id: ${id}`);
  console.log(`${indent}  parent: ${parentType}`);

  if (depth >= 3) {
    console.log(`${indent}  (stopping recursion at depth ${depth})`);
    return;
  }

  // If database: list its pages
  if (type === "database") {
    await rl();
    const res = await notion.databases.query({ database_id: id, page_size: 10 });
    console.log(`${indent}  contains ${res.results.length} pages (showing up to 10)`);
    for (const page of res.results.slice(0, 5)) {
      let ptitle = "(untitled)";
      for (const key of Object.keys(page.properties || {})) {
        const prop = page.properties[key];
        if (prop.type === "title" && prop.title?.length) {
          ptitle = prop.title.map(t => t.plain_text).join("").trim();
          break;
        }
      }
      console.log(`${indent}  → page: "${ptitle}" (${page.id})`);
      await inspect(page.id, depth + 2, visited);
    }
  }

  // If page: list its child blocks
  if (type === "page") {
    await rl();
    const res = await notion.blocks.children.list({ block_id: id, page_size: 50 });
    const interesting = res.results.filter(b => b.type === "child_page" || b.type === "child_database");
    if (interesting.length) {
      console.log(`${indent}  has ${interesting.length} child pages/databases:`);
      for (const block of interesting) {
        const label = block.type === "child_page"
          ? block.child_page?.title || "(untitled)"
          : block.child_database?.title || "(untitled db)";
        console.log(`${indent}  → ${block.type}: "${label}" (${block.id})`);
        await inspect(block.id, depth + 2, visited);
      }
    } else {
      console.log(`${indent}  no child pages/databases found in blocks`);
    }
  }
}

async function main() {
  if (!ROOT_ID) throw new Error("Missing NOTION_PAGE_ID");
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");

  console.log(`\n🔍 Inspecting Notion structure from root: ${ROOT_ID}\n`);
  await inspect(ROOT_ID);
  console.log("\n✅ Inspection complete");
}

main().catch(err => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
