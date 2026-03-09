/**
 * fetch-notion.js — Biologotters by AlexValve
 *
 * Two modes:
 *  1. HOMEPAGE: reads the intro blocks from Notion and injects them
 *     between NOTION_INTRO_START / NOTION_INTRO_END markers in index.html
 *  2. PAGES: generates full HTML pages for content pages (temas, cursos, etc.)
 *
 * Requires: NOTION_TOKEN environment variable
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const TOKEN   = process.env.NOTION_TOKEN;
const VERSION = "2022-06-28";

if (!TOKEN) {
  console.error("❌  Missing NOTION_TOKEN environment variable");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// HOMEPAGE — only the intro section comes from Notion.
// Blocks are read until the first h2 / divider / child_page.
// ─────────────────────────────────────────────────────────────
const HOMEPAGE_NOTION_ID = "7396d9f14c14440683d7b82abb171a51";

// ─────────────────────────────────────────────────────────────
// CONTENT PAGES — full pages generated from Notion
// Add entries here as you expand the site.
// ─────────────────────────────────────────────────────────────
const PAGES = [
  // Temario IB
  // { id: "PAGE_ID", outFile: "temas/a-unidad-diversidad/index.html", navTitle: "A: Unidad y Diversidad" },
  // { id: "PAGE_ID", outFile: "temas/b-estructura-funcion/index.html", navTitle: "B: Estructura y Función" },
  // { id: "PAGE_ID", outFile: "temas/c-interaccion-interdependencia/index.html", navTitle: "C: Interacción e Interdependencia" },
  // { id: "PAGE_ID", outFile: "temas/d-continuidad-cambio/index.html", navTitle: "D: Continuidad y Cambio" },

  // Componentes IB
  // { id: "PAGE_ID", outFile: "componentes-ib/evaluacion-interna/index.html", navTitle: "Evaluación Interna" },
  // { id: "PAGE_ID", outFile: "componentes-ib/monografia/index.html", navTitle: "Monografía" },

  // Habilidades
  // { id: "PAGE_ID", outFile: "habilidades/analisis-estadistico/index.html", navTitle: "Análisis Estadístico" },
];

// ─────────────────────────────────────────────────────────────
// Notion API
// ─────────────────────────────────────────────────────────────
function notionRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.notion.com",
      path:     `/v1/${endpoint}`,
      method:   "GET",
      headers: {
        "Authorization":  `Bearer ${TOKEN}`,
        "Notion-Version": VERSION,
        "Content-Type":   "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse error: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function getAllBlocks(blockId) {
  let results = [];
  let cursor  = null;
  do {
    const qs  = `page_size=100${cursor ? "&start_cursor=" + cursor : ""}`;
    const res = await notionRequest(`blocks/${blockId}/children?${qs}`);
    results   = results.concat(res.results || []);
    cursor    = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return results;
}

async function getPage(pageId) {
  return notionRequest(`pages/${pageId}`);
}

// ─────────────────────────────────────────────────────────────
// Rich text → HTML
// ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function richText(rts) {
  if (!rts || !rts.length) return "";
  return rts.map(rt => {
    let t = esc(rt.plain_text);
    if (rt.annotations.bold)          t = `<strong>${t}</strong>`;
    if (rt.annotations.italic)        t = `<em>${t}</em>`;
    if (rt.annotations.strikethrough) t = `<s>${t}</s>`;
    if (rt.annotations.underline)     t = `<u>${t}</u>`;
    if (rt.annotations.code)          t = `<code>${t}</code>`;
    if (rt.href)                       t = `<a href="${rt.href}">${t}</a>`;
    return t;
  }).join("");
}

// ─────────────────────────────────────────────────────────────
// Blocks → HTML
// ─────────────────────────────────────────────────────────────
const CALLOUT_COLOR_MAP = {
  "red_background":    "red",
  "green_background":  "green",
  "yellow_background": "yellow",
  "blue_background":   "blue",
  "gray_background":   "gray",
  "purple_background": "blue",
  "pink_background":   "red",
  "orange_background": "yellow",
  "default":           "blue",
};

async function blocksToHtml(blocks) {
  let html = "";
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    const type  = block.type;
    const data  = block[type] || {};

    switch (type) {

      case "paragraph": {
        const t = richText(data.rich_text);
        html += t ? `<p>${t}</p>\n` : `<div class="sp"></div>\n`;
        break;
      }

      case "heading_1":
        html += `<h1 class="notion-h1">${richText(data.rich_text)}</h1>\n`;
        break;

      case "heading_2":
        html += `<h2>${richText(data.rich_text)}</h2>\n`;
        break;

      case "heading_3":
        html += `<h3>${richText(data.rich_text)}</h3>\n`;
        break;

      case "bulleted_list_item": {
        html += `<ul>\n`;
        while (i < blocks.length && blocks[i].type === "bulleted_list_item") {
          html += `  <li>${richText(blocks[i].bulleted_list_item.rich_text)}</li>\n`;
          i++;
        }
        html += `</ul>\n`;
        continue;
      }

      case "numbered_list_item": {
        html += `<ol>\n`;
        while (i < blocks.length && blocks[i].type === "numbered_list_item") {
          html += `  <li>${richText(blocks[i].numbered_list_item.rich_text)}</li>\n`;
          i++;
        }
        html += `</ol>\n`;
        continue;
      }

      case "callout": {
        const emoji = data.icon?.emoji || "💡";
        const color = CALLOUT_COLOR_MAP[data.color] || "blue";
        const text  = richText(data.rich_text);
        let childHtml = "";
        if (block.has_children) {
          const ch = await getAllBlocks(block.id);
          childHtml = await blocksToHtml(ch);
        }
        html += `<div class="callout ${color}">\n`;
        html += `  <div class="icon">${emoji}</div>\n`;
        html += `  <div class="body"><p>${text}</p>${childHtml}</div>\n`;
        html += `</div>\n`;
        break;
      }

      case "quote":
        html += `<blockquote>${richText(data.rich_text)}</blockquote>\n`;
        break;

      case "divider":
        html += `<hr>\n`;
        break;

      case "image": {
        const url     = data.type === "external" ? data.external?.url : data.file?.url || "";
        const caption = data.caption?.length ? richText(data.caption) : "";
        html += `<figure class="notion-image">\n`;
        html += `  <img src="${url}" alt="${caption}" loading="lazy">\n`;
        if (caption) html += `  <figcaption>${caption}</figcaption>\n`;
        html += `</figure>\n`;
        break;
      }

      case "column_list": {
        if (block.has_children) {
          const cols  = await getAllBlocks(block.id);
          const cls   = cols.length >= 3 ? "cols cols3" : "cols";
          html += `<div class="${cls}">\n`;
          for (const col of cols) {
            const cb  = await getAllBlocks(col.id);
            const ch  = await blocksToHtml(cb);
            html += `<div>${ch}</div>\n`;
          }
          html += `</div>\n`;
        }
        break;
      }

      case "toggle": {
        const summary = richText(data.rich_text);
        let inner = "";
        if (block.has_children) {
          const ch = await getAllBlocks(block.id);
          inner = await blocksToHtml(ch);
        }
        html += `<details class="notion-toggle">\n`;
        html += `  <summary>${summary}</summary>\n`;
        html += `  <div class="toggle-body">${inner}</div>\n`;
        html += `</details>\n`;
        break;
      }

      case "code": {
        const lang = data.language || "";
        html += `<pre class="notion-code"><code class="language-${lang}">${richText(data.rich_text)}</code></pre>\n`;
        break;
      }

      case "child_page":
      case "table_of_contents":
      case "breadcrumb":
        break; // skip

      default:
        break;
    }

    i++;
  }

  return html;
}

// ─────────────────────────────────────────────────────────────
// HOMEPAGE injection
// ─────────────────────────────────────────────────────────────
async function buildHomepage() {
  console.log("\n🏠  Updating homepage intro from Notion...");

  const blocks = await getAllBlocks(HOMEPAGE_NOTION_ID);

  // Take only intro blocks — stop before first h2, divider, or child_page
  const introBlocks = [];
  for (const block of blocks) {
    if (["heading_2", "heading_1", "divider", "child_page"].includes(block.type)) break;
    introBlocks.push(block);
  }

  console.log(`    Intro blocks: ${introBlocks.length}`);

  const introHtml = await blocksToHtml(introBlocks);

  const indexPath = path.join(__dirname, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  const start = "<!-- NOTION_INTRO_START -->";
  const end   = "<!-- NOTION_INTRO_END -->";
  const si    = html.indexOf(start);
  const ei    = html.indexOf(end);

  if (si === -1 || ei === -1) {
    console.warn("    ⚠️  Markers not found in index.html — skipping homepage injection");
    return;
  }

  html = html.slice(0, si + start.length) + "\n" + introHtml + "        " + html.slice(ei);
  fs.writeFileSync(indexPath, html, "utf8");
  console.log("    ✅  Homepage intro updated");
}

// ─────────────────────────────────────────────────────────────
// Full page template
// ─────────────────────────────────────────────────────────────
function pageTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Biologotters</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>
<style>
:root {
  --font-ui:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --font-heading:'Noto Sans',sans-serif;
  --text:#37352f; --text-secondary:#6b6c6b; --text-muted:#9b9a97;
  --bg:#ffffff; --bg-secondary:#f7f6f3; --bg-hover:#efefef; --border:#e9e9e7;
  --green:hsl(149,31%,39%); --green-bg:hsl(149,40%,93%);
  --red:hsl(2,62%,52%);     --red-bg:hsl(2,60%,93%);
  --yellow:hsl(38,62%,49%); --yellow-bg:hsl(40,80%,93%);
  --blue:hsl(202,53%,43%);  --blue-bg:hsl(202,60%,93%);
  --navbar-bg:#ffffff; --navbar-border:#e9e9e7;
  --sidebar-bg:#fbfbfa; --sidebar-border:#e9e9e7;
  --sidebar-shadow:2px 0 18px rgba(0,0,0,.09); --sidebar-w:252px;
}
[data-theme="dark"] {
  --text:#e1e1e1; --text-secondary:#9b9b9b; --text-muted:#6b6b6b;
  --bg:#191919; --bg-secondary:#202020; --bg-hover:#262626; --border:#373737;
  --green:hsl(146,32%,50%); --green-bg:hsl(149,20%,16%);
  --red:hsl(1,60%,60%);     --red-bg:hsl(6,25%,18%);
  --yellow:hsl(38,54%,54%); --yellow-bg:hsl(38,25%,18%);
  --blue:hsl(217,50%,62%);  --blue-bg:hsl(215,20%,18%);
  --navbar-bg:#191919; --navbar-border:#373737;
  --sidebar-bg:#1e1e1e; --sidebar-border:#373737;
  --sidebar-shadow:2px 0 24px rgba(0,0,0,.4);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px}
body{font-family:var(--font-ui);font-size:15px;line-height:1.65;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
#app{display:flex;flex-direction:column;min-height:100vh}
#body-row{display:flex;flex:1}
#navbar{position:sticky;top:0;z-index:200;height:48px;background:var(--navbar-bg);border-bottom:1px solid var(--navbar-border);display:flex;align-items:center;padding:0 14px;gap:8px}
#nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;flex-shrink:0}
#logo-img{height:32px;width:auto;object-fit:contain;display:none}
#logo-fallback{display:flex;align-items:center;gap:5px}
#logo-fallback .ot{font-size:22px;line-height:1}
#logo-fallback .wm{font-size:15px;font-weight:700;color:var(--text);letter-spacing:-.02em}
#nav-spacer{flex:1}
#nav-links{display:flex;align-items:center;gap:2px}
#nav-links a{font-size:13.5px;font-weight:500;color:var(--text-secondary);padding:5px 10px;border-radius:5px;transition:background 120ms,color 120ms;white-space:nowrap}
#nav-links a:hover{background:var(--bg-hover);color:var(--text);text-decoration:none}
#nav-links a.active{color:var(--text);background:var(--bg-hover)}
#menu-btn{display:none}
.nav-btn{width:32px;height:32px;border:none;background:transparent;color:var(--text);cursor:pointer;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 120ms;flex-shrink:0}
.nav-btn:hover{background:var(--bg-hover)}
.nav-btn svg{width:16px;height:16px;pointer-events:none}
#sidebar{position:fixed;top:48px;left:0;width:var(--sidebar-w);height:calc(100vh - 48px);background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);box-shadow:var(--sidebar-shadow);padding:6px 0 24px;overflow-y:auto;flex-shrink:0;display:flex;flex-direction:column;z-index:150;scrollbar-width:thin;scrollbar-color:var(--border) transparent;transform:translateX(-100%);transition:transform .22s ease}
#sidebar.open{transform:translateX(0)}
#sidebar::-webkit-scrollbar{width:4px}
#sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
#sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:149;cursor:pointer}
#sidebar-overlay.open{display:block}
.sb-search{display:flex;align-items:center;gap:6px;margin:4px 8px 6px;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px}
.sb-search svg{flex-shrink:0;color:var(--text-muted)}
.sb-search input{border:none;background:transparent;font-size:13px;color:var(--text);width:100%;outline:none;font-family:var(--font-ui)}
.sb-search input::placeholder{color:var(--text-muted)}
.nav-group{margin-bottom:1px}
.nav-group-header{display:flex;align-items:center;justify-content:space-between;padding:4px 8px 4px 10px;margin:0 4px;cursor:pointer;border-radius:4px;transition:background 100ms;user-select:none}
.nav-group-header:hover{background:var(--bg-hover)}
.nav-group-label{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--text)}
.nav-group-emoji{font-size:13px}
.nav-chevron{font-size:9px;color:var(--text-muted);transform:rotate(-90deg);transition:transform 150ms}
.nav-group-header.open .nav-chevron{transform:rotate(0deg)}
.nav-group-items{display:none;flex-direction:column;padding:1px 4px 2px 20px}
.nav-group-items.open{display:flex}
.nav-group-items a{font-size:13px;color:var(--text-secondary);padding:4px 8px;border-radius:4px;transition:background 100ms,color 100ms;line-height:1.4}
.nav-group-items a:hover{background:var(--bg-hover);color:var(--text)}
.nav-group-items a.active{background:var(--bg-hover);color:var(--text);font-weight:500}
.sb-footer-link{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);padding:4px 10px;margin:6px 4px 0;border-radius:4px;margin-top:auto;transition:background 100ms,color 100ms}
.sb-footer-link:hover{background:var(--bg-hover);color:var(--text)}
#main{flex:1;min-width:0;width:100%}
.page-header,.notion-body{max-width:720px;margin:0 auto;padding-left:48px;padding-right:48px}
.page-title{font-family:var(--font-heading);font-size:2rem;font-weight:700;color:var(--text);line-height:1.25;letter-spacing:-.02em;padding:2rem 0 .5rem}
.notion-body{padding-top:.5rem;padding-bottom:5rem}
.notion-body p{font-size:15px;line-height:1.65;color:var(--text);margin-bottom:4px}
.notion-body h1.notion-h1{font-family:var(--font-heading);font-size:1.75rem;font-weight:700;color:var(--text);margin:1.8em 0 .4em;line-height:1.25;letter-spacing:-.02em}
.notion-body h2{font-family:var(--font-heading);font-size:1.25rem;font-weight:600;color:var(--text);letter-spacing:-.01em;margin:1.8em 0 .4em;line-height:1.3}
.notion-body h3{font-family:var(--font-heading);font-size:1.05rem;font-weight:600;color:var(--text);margin:1.2em 0 .25em;line-height:1.3}
.notion-body hr{border:none;border-top:1px solid var(--border);margin:1.75rem 0}
.notion-body ul,.notion-body ol{padding-left:1.5rem;margin:4px 0 8px}
.notion-body li{font-size:15px;line-height:1.65;margin-bottom:2px}
.notion-body a{color:var(--blue);text-decoration:underline;text-underline-offset:2px}
.notion-body a:hover{opacity:.75}
.notion-body code{background:rgba(135,131,120,.15);border-radius:3px;padding:1px 5px;font-size:13px;font-family:'SFMono-Regular',Consolas,monospace}
.notion-body blockquote{border-left:3px solid var(--border);padding-left:1rem;color:var(--text-secondary);margin:8px 0}
.notion-body pre.notion-code{background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:1rem 1.25rem;overflow-x:auto;margin:8px 0}
.notion-body pre.notion-code code{background:none;padding:0;font-size:13px}
.notion-image{margin:1rem 0}
.notion-image img{border-radius:6px;width:100%}
.notion-image figcaption{font-size:13px;color:var(--text-muted);text-align:center;margin-top:6px}
.callout{display:flex;gap:10px;padding:12px 14px;border-radius:4px;margin:6px 0;font-size:14px;line-height:1.6;border:1px solid transparent}
.callout .icon{font-size:17px;flex-shrink:0;padding-top:1px}
.callout .body{flex:1}
.callout .body p{font-size:14px;margin-bottom:3px}
.callout.red{background:var(--red-bg)}
.callout.green{background:var(--green-bg)}
.callout.yellow{background:var(--yellow-bg)}
.callout.blue{background:var(--blue-bg)}
.callout.gray{background:var(--bg-secondary)}
[data-theme="dark"] .callout{border-color:rgba(255,255,255,.05)}
.cols{display:grid;gap:1.25rem;grid-template-columns:1fr 1fr;margin:.5rem 0}
.cols.cols3{grid-template-columns:1fr 1fr 1fr}
.notion-toggle{border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin:4px 0}
.notion-toggle summary{cursor:pointer;font-weight:500;font-size:15px;list-style:none;display:flex;align-items:center;gap:6px}
.notion-toggle summary::before{content:"▶";font-size:9px;color:var(--text-muted);transition:transform 150ms}
.notion-toggle[open] summary::before{transform:rotate(90deg)}
.toggle-body{padding-top:8px;padding-left:16px}
.sp{height:8px}.sp2{height:16px}
#footer{border-top:1px solid var(--border);background:var(--bg);padding:1.25rem 48px}
.footer-inner{max-width:720px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.footer-copy{font-size:13px;color:var(--text-secondary)}
.footer-links{font-size:13px;display:flex;gap:1rem}
.footer-links a{color:var(--text-secondary)}
.footer-links a:hover{color:var(--text)}
#search-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:500;align-items:flex-start;justify-content:center;padding-top:14vh}
#search-overlay.open{display:flex}
.search-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.15);width:92%;max-width:520px;overflow:hidden}
.search-row{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}
.search-row svg{color:var(--text-muted);flex-shrink:0}
.search-row input{flex:1;border:none;background:transparent;font-size:15px;color:var(--text);outline:none;font-family:var(--font-ui)}
.search-row input::placeholder{color:var(--text-muted)}
#search-close{border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-size:16px;padding:2px 5px;border-radius:4px}
#search-close:hover{background:var(--bg-hover)}
#search-results{padding:6px 0;max-height:320px;overflow-y:auto}
.sr-item{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;font-size:14px;color:var(--text);cursor:pointer}
.sr-item:hover{background:var(--bg-hover)}
.sr-section{font-size:12px;color:var(--text-muted)}
.sr-empty{padding:16px 14px;font-size:13px;color:var(--text-muted);text-align:center}
@media(max-width:800px){
  #nav-links{display:none}#menu-btn{display:flex}
  .page-header,.notion-body{padding-left:20px;padding-right:20px}
  .page-title{font-size:1.5rem}.cols{grid-template-columns:1fr}
  #footer{padding:1rem 20px}.footer-inner{flex-direction:column}
}
</style>
</head>
<body>
<div id="app">
  <nav id="navbar">
    <a id="nav-logo" href="/"><img id="logo-img" src="" alt="Biologotters"><span id="logo-fallback"><span class="ot">🦦</span><span class="wm">biologotters</span></span></a>
    <div id="nav-spacer"></div>
    <div id="nav-links">
      <a href="/temas/">Biología IB</a>
      <a href="/cursos/">Cursos</a>
      <a href="/componentes-ib/">Componentes del IB</a>
      <a href="/habilidades/">Habilidades</a>
    </div>
    <button class="nav-btn" onclick="openSearch()" title="Buscar"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg></button>
    <button class="nav-btn" onclick="toggleDark()" title="Tema"><svg id="icon-moon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"/></svg><svg id="icon-sun" style="display:none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg></button>
    <button class="nav-btn" id="menu-btn" onclick="toggleSidebar()" title="Menú"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"/></svg></button>
  </nav>
  <div id="body-row">
    <aside id="sidebar"><div id="sidebar-nav"></div></aside>
    <div id="sidebar-overlay" onclick="closeSidebar()"></div>
    <main id="main">
      <div class="page-header"><h1 class="page-title">${esc(title)}</h1></div>
      <article class="notion-body">${bodyHtml}</article>
    </main>
  </div>
  <footer id="footer">
    <div class="footer-inner">
      <p class="footer-copy">Biologotters | licencia CC BY-NC-SA 4.0 | powered by ValveVision</p>
      <div class="footer-links"><a href="/sobre-mi/">Sobre Mí</a><a href="/componentes-ib/evaluacion-interna/">EI</a><a href="/habilidades/">Habilidades</a></div>
    </div>
  </footer>
</div>
<div id="search-overlay"><div class="search-box"><div class="search-row"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" id="search-input" placeholder="Buscar páginas y temas..."><button id="search-close" onclick="closeSearch()">✕</button></div><div id="search-results"></div></div></div>
<script>
const NAV_DATA=[{id:"biologia-ib",emoji:"🧬",label:"Biología IB",items:[{label:"Temas",href:"/temas/"},{label:"A: Unidad y Diversidad",href:"/temas/a-unidad-diversidad/"},{label:"B: Estructura y Función",href:"/temas/b-estructura-funcion/"},{label:"C: Interacción e Interdependencia",href:"/temas/c-interaccion-interdependencia/"},{label:"D: Continuidad y Cambio",href:"/temas/d-continuidad-cambio/"}]},{id:"temas-2016",emoji:"📚",label:"Temas 2016",items:[{label:"Tema 1: Biología Celular",href:"/temas-2016/biologia-celular/"},{label:"Tema 2: Bioquímica",href:"/temas-2016/bioquimica/"},{label:"Tema 3: Genética",href:"/temas-2016/genetica/"},{label:"Tema 4: Ecología",href:"/temas-2016/ecologia/"},{label:"Tema 5: Evolución y Biodiversidad",href:"/temas-2016/evolucion-biodiversidad/"},{label:"Tema 6: Fisiología Humana",href:"/temas-2016/fisiologia-humana/"}]},{id:"cursos",emoji:"🎓",label:"Cursos",items:[{label:"Biology I",href:"/cursos/biology-i/"},{label:"Procesos Biológicos",href:"/cursos/procesos-biologicos/"}]},{id:"componentes-ib",emoji:"🏫",label:"Componentes del IB",items:[{label:"Perfil de la Comunidad IB",href:"/componentes-ib/perfil-comunidad/"},{label:"Evaluación Interna (EI)",href:"/componentes-ib/evaluacion-interna/"},{label:"Monografía",href:"/componentes-ib/monografia/"},{label:"Proyecto del Grupo 4",href:"/componentes-ib/grupo-4/"}]},{id:"habilidades",emoji:"🔬",label:"Habilidades",items:[{label:"Análisis Estadístico",href:"/habilidades/analisis-estadistico/"},{label:"Diseño Experimental",href:"/habilidades/diseno-experimental/"},{label:"Procesamiento de Datos",href:"/habilidades/procesamiento-datos/"},{label:"Presentación de Resultados",href:"/habilidades/presentacion-resultados/"}]}];
function renderSidebar(){const el=document.getElementById("sidebar-nav");if(!el)return;const path=window.location.pathname.replace(/\/$/,"")||"/";let html=\`<div class="sb-search"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" placeholder="Buscar contenido..." oninput="filterSidebar(this.value)"></div>\`;for(const g of NAV_DATA){const active=g.items.some(i=>path.startsWith(i.href.replace(/\/$/,"")));html+=\`<div class="nav-group"><div class="nav-group-header\${active?" open":""}" onclick="toggleGroup(this)"><span class="nav-group-label"><span class="nav-group-emoji">\${g.emoji}</span>\${g.label}</span><span class="nav-chevron">▼</span></div><div class="nav-group-items\${active?" open":""}">\`;for(const item of g.items){const a=path===item.href.replace(/\/$/,"")||path.startsWith(item.href.replace(/\/$/,"")+"/");html+=\`<a href="\${item.href}"\${a?' class="active"':""}>\${item.label}</a>\`;}html+=\`</div></div>\`;}html+=\`<a href="/sobre-mi/" class="sb-footer-link">👤 Sobre Mí</a>\`;el.innerHTML=html;}
function toggleGroup(h){h.classList.toggle("open");h.nextElementSibling.classList.toggle("open");}
function filterSidebar(q){q=q.toLowerCase().trim();document.querySelectorAll(".nav-group").forEach(g=>{const links=g.querySelectorAll(".nav-group-items a");let any=false;links.forEach(l=>{const s=!q||l.textContent.toLowerCase().includes(q);l.style.display=s?"":"none";if(s)any=true;});if(q){g.style.display=any?"":"none";if(any){g.querySelector(".nav-group-header").classList.add("open");g.querySelector(".nav-group-items").classList.add("open");}}else{g.style.display="";}});}
function toggleSidebar(){document.getElementById("sidebar").classList.toggle("open");document.getElementById("sidebar-overlay").classList.toggle("open");}
function closeSidebar(){document.getElementById("sidebar").classList.remove("open");document.getElementById("sidebar-overlay").classList.remove("open");}
function toggleDark(){const n=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);localStorage.setItem("theme",n);updateIcon(n);}
function updateIcon(t){document.getElementById("icon-moon").style.display=t==="dark"?"none":"";document.getElementById("icon-sun").style.display=t==="dark"?"":"none";}
const IDX=NAV_DATA.flatMap(g=>g.items.map(i=>({...i,section:g.label})));IDX.push({label:"Inicio",href:"/",section:"Navegación"},{label:"Sobre Mí",href:"/sobre-mi/",section:"Navegación"});
function openSearch(){document.getElementById("search-overlay").classList.add("open");setTimeout(()=>document.getElementById("search-input").focus(),80);}
function closeSearch(){document.getElementById("search-overlay").classList.remove("open");document.getElementById("search-input").value="";emptyState();}
function emptyState(){document.getElementById("search-results").innerHTML=\`<div class="sr-empty">Escribe para buscar páginas y temas...</div>\`;}
document.addEventListener("DOMContentLoaded",()=>{
  const t=localStorage.getItem("theme")||"light";document.documentElement.setAttribute("data-theme",t);updateIcon(t);
  renderSidebar();
  document.getElementById("search-input").addEventListener("input",function(){const q=this.value.toLowerCase().trim();const r=document.getElementById("search-results");if(!q){emptyState();return;}const hits=IDX.filter(i=>i.label.toLowerCase().includes(q)).slice(0,10);r.innerHTML=hits.length?hits.map(m=>\`<a href="\${m.href}" class="sr-item"><span>\${m.label}</span><span class="sr-section">\${m.section}</span></a>\`).join(""):\`<div class="sr-empty">Sin resultados para "<strong>\${q}</strong>"</div>\`;});
  emptyState();
  document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="k"){e.preventDefault();openSearch();}if(e.key==="Escape")closeSearch();});
  document.getElementById("search-overlay").addEventListener("click",e=>{if(e.target.id==="search-overlay")closeSearch();});
  fetch("/content/settings.json").then(r=>r.json()).then(s=>{if(s.logo){const i=document.getElementById("logo-img");i.src=s.logo;i.style.display="block";document.getElementById("logo-fallback").style.display="none";}if(s.favicon){const l=document.querySelector("link[rel~='icon']")||Object.assign(document.createElement("link"),{rel:"icon"});l.href=s.favicon;document.head.appendChild(l);}}).catch(()=>{});
});
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Build a full content page
// ─────────────────────────────────────────────────────────────
async function buildPage(config) {
  console.log(`\n📄  Building: ${config.outFile}`);
  const page   = await getPage(config.id);
  const title  = config.navTitle || getPageTitle(page);
  const blocks = await getAllBlocks(config.id);
  console.log(`    Title: ${title} | Blocks: ${blocks.length}`);
  const bodyHtml = await blocksToHtml(blocks);
  const fullHtml = pageTemplate(title, bodyHtml);
  const outPath  = path.join(__dirname, config.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fullHtml, "utf8");
  console.log(`    ✅  Written`);
}

function getPageTitle(page) {
  const tp = page.properties?.title || page.properties?.Name;
  if (tp?.title?.length) return tp.title.map(t => t.plain_text).join("");
  return "Sin título";
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀  Biologotters — Notion build starting...");

  // 1. Inject homepage intro
  await buildHomepage();

  // 2. Build content pages
  if (PAGES.length) {
    console.log(`\n📚  Building ${PAGES.length} content page(s)...`);
    for (const config of PAGES) {
      try { await buildPage(config); }
      catch (err) { console.error(`❌  Failed: ${config.outFile} —`, err.message); }
    }
  } else {
    console.log("\n📚  No content pages configured yet.");
  }

  console.log("\n✨  Build complete.");
}

main();
