// Static site build: node build.mjs  ->  dist/
//
// Renders every page from src/catalog.mjs so each product, team, category and
// search landing page has its own crawlable URL, title, description and
// schema.org markup. Optional build-time env vars:
//   GA_MEASUREMENT_ID  (e.g. G-XXXXXXX)   META_PIXEL_ID  (e.g. 1234567890)

import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, CATEGORIES, TEAMS, PRODUCTS, LANDING_PAGES } from "./src/catalog.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist");
const GA = process.env.GA_MEASUREMENT_ID || "";
const PIXEL = process.env.META_PIXEL_ID || "";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = n => "$" + n.toFixed(2);
const productUrl = p => `/products/${p.id}/`;
const teamUrl = slug => `/teams/${slug}/`;
const abs = path => SITE.url + path;
const ldJson = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// Live products first, then Philly → NY → everyone else, keeping catalog order otherwise.
const TEAM_ORDER = Object.keys(TEAMS);
const teamRank = p => Math.min(...p.teams.map(t => TEAM_ORDER.indexOf(t)).filter(i => i >= 0), 99);
const sorted = list => [...list].sort((a, b) => (b.available - a.available) || (teamRank(a) - teamRank(b)));
const live = PRODUCTS.filter(p => p.available);
const teamsWithProducts = TEAM_ORDER.filter(slug => PRODUCTS.some(p => p.teams.includes(slug)));

const pages = []; // [path, html] for the sitemap

function write(path, html) {
  const file = path.endsWith("/") ? join(OUT, path, "index.html") : join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

function page(path, html, { sitemap = true } = {}) {
  write(path, html);
  if (sitemap) pages.push(path);
}

/* ---------------- Layout ---------------- */

function analyticsHead() {
  let out = "";
  if (GA) {
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(GA)}');</script>`;
  }
  if (PIXEL) {
    out += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${esc(PIXEL)}');fbq('track','PageView');</script>`;
  }
  return out;
}

function layout({ path, title, description, body, image, schema = [], pageName = "", noindex = false }) {
  const url = abs(path);
  const ogImage = abs(image || "/assets/pressbox-crest-logo.png");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/pressbox-crest-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${analyticsHead()}
${schema.map(ldJson).join("\n")}
</head>
<body data-page="${esc(pageName)}">
${header()}
<main>
${body}
</main>
${footer()}
${drawer()}
<script src="/catalog.js"></script>
<script src="/site.js" defer></script>
</body>
</html>`;
}

function header() {
  const cats = Object.values(CATEGORIES).map(c => `<a class="cat-tab" href="${c.path}">${esc(c.label)}</a>`).join("");
  const philly = ["eagles", "76ers", "phillies"].map(t => `<a class="cat-tab" href="${teamUrl(t)}">${TEAMS[t].short}</a>`).join("");
  return `
<div class="trust-topbar">
  <div class="container trust-topbar-inner">
    <div>Free shipping over $${SITE.freeShippingMin} • <span class="trust-pill-gold">${SITE.bundlePercent}% off any ${SITE.bundleMinItems}+ items</span></div>
    <div>Officially licensed gear • Sneakers checked for authenticity before they ship</div>
  </div>
</div>
<header class="site-header">
  <div class="container header-main">
    <a href="/" class="brand-lockup">
      <img src="/assets/pressbox-crest-logo.png" alt="" class="brand-crest" width="52" height="52">
      <div class="brand-title">PRESS BOX <span>KICKS &amp; JERSEYS</span></div>
    </a>
    <form class="search-wrapper" id="search-form" action="/" method="get" role="search">
      <div class="search-box">
        <input class="search-input" id="main-search-input" name="q" type="search" placeholder="Search Eagles, Iverson, Jordan 4, 59FIFTY…" aria-label="Search products">
        <button class="search-btn" type="submit">SEARCH</button>
      </div>
    </form>
    <div class="header-actions">
      <button type="button" class="locker-cart-btn" data-open-locker aria-label="Open your locker">
        LOCKER <span class="locker-count-badge" data-locker-count>0</span> <span data-locker-total>$0.00</span>
      </button>
    </div>
  </div>
  <nav class="category-navbar" aria-label="Shop">
    <div class="container category-tabs">
      ${philly}${cats}
      <a class="cat-tab" href="/shipping-returns/">Shipping &amp; Returns</a>
    </div>
  </nav>
</header>`;
}

function footer() {
  const teamLinks = teamsWithProducts.map(t => `<li><a href="${teamUrl(t)}">${esc(TEAMS[t].name)}</a></li>`).join("");
  const catLinks = Object.values(CATEGORIES).map(c => `<li><a href="${c.path}">${esc(c.label)}</a></li>`).join("");
  const landing = LANDING_PAGES.map(l => `<li><a href="${l.path}">${esc(l.h1)}</a></li>`).join("");
  return `
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-col">
        <h4>Press Box Kicks &amp; Jerseys</h4>
        <p>Philly and New York throwbacks, fitteds and sneakers, shipped across the US.</p>
        <p><a href="mailto:${SITE.email}">${SITE.email}</a><br>
        Instagram <a href="https://instagram.com/${SITE.instagram}" rel="noopener">@${SITE.instagram}</a></p>
      </div>
      <div class="footer-col"><h4>Shop by team</h4><ul>${teamLinks}</ul></div>
      <div class="footer-col"><h4>Shop</h4><ul>${catLinks}${landing}</ul></div>
      <div class="footer-col"><h4>Help</h4><ul>
        <li><a href="/shipping-returns/">Shipping &amp; returns</a></li>
        <li><a href="/contact/">Contact</a></li>
        <li><a href="/shipping-returns/#authenticity">Authenticity</a></li>
      </ul></div>
    </div>
    <div class="footer-legal">
      <div>© ${new Date().getFullYear()} ${esc(SITE.legalName)}, doing business as ${esc(SITE.name)}.</div>
      <div>Team names and player names identify officially licensed merchandise. ${esc(SITE.name)} is not affiliated with the NFL, NBA, MLB or any team.</div>
    </div>
  </div>
</footer>`;
}

function drawer() {
  return `
<div class="drawer-backdrop" id="drawer-backdrop"></div>
<aside class="locker-drawer" id="locker-drawer" aria-label="Your locker">
  <div class="drawer-header">
    <h3>Your Locker</h3>
    <button type="button" class="drawer-close-btn" data-close-locker aria-label="Close">✕</button>
  </div>
  <div class="drawer-perk-banner" id="drawer-perk"></div>
  <div class="drawer-items" id="drawer-items-list"></div>
  <div class="drawer-footer">
    <div class="drawer-line"><span>Subtotal</span><span id="drawer-subtotal">$0.00</span></div>
    <div class="drawer-line discount" id="drawer-discount-row" style="display:none"><span>${SITE.bundlePercent}% off ${SITE.bundleMinItems}+ items</span><span id="drawer-discount-val"></span></div>
    <div class="drawer-line"><span>Shipping</span><span id="drawer-shipping">—</span></div>
    <div class="drawer-line total"><span>Total</span><span id="drawer-grand-total">$0.00</span></div>
    <button type="button" class="btn-gold btn-block" id="checkout-btn" disabled>Secure checkout</button>
    <p class="checkout-msg" id="checkout-msg" role="status"></p>
    <p class="drawer-fineprint">Pay with card, Apple Pay or Google Pay on Stripe's secure checkout. Sales tax, if any, is shown before you pay.</p>
  </div>
</aside>`;
}

/* ---------------- Components ---------------- */

function sizeLabel(p) {
  return { sneaker: "US men's size", hat: "Hat size", slides: "Slide size" }[p.sizeType] || "Size";
}

function notifyForm(p) {
  return `
<form class="notify-form" name="notify" method="POST" action="/notify-thanks/" data-netlify="true" netlify-honeypot="company">
  <input type="hidden" name="form-name" value="notify">
  <input type="hidden" name="product" value="${esc(p ? p.title : "Mitchell & Ness throwback launch")}">
  <p class="hp-field"><label>Company <input name="company" tabindex="-1" autocomplete="off"></label></p>
  <label class="notify-label" for="notify-${p ? p.id : "list"}">Email me when it launches</label>
  <div class="notify-row">
    <input id="notify-${p ? p.id : "list"}" type="email" name="email" required placeholder="you@email.com" autocomplete="email">
    <button type="submit" class="btn-navy">Notify me</button>
  </div>
</form>`;
}

function productCard(p) {
  const search = `${p.title} ${p.name} ${p.brand} ${p.teams.map(t => TEAMS[t].name).join(" ")} ${p.sku}`.toLowerCase();
  const teamSelect = p.teamOptions
    ? `<select class="team-select" aria-label="Team for ${esc(p.name)}"><option value="">Choose team…</option>${p.teamOptions.map(t => `<option>${esc(t)}</option>`).join("")}</select>`
    : "";
  const buy = p.available
    ? `<div class="card-size-selector">
        <div class="card-size-label"><span>${sizeLabel(p)}</span><strong data-chosen-size>${esc(p.defaultSize)}</strong></div>
        <div class="card-size-pills">${p.sizes.map(s => `<button type="button" class="card-size-btn${s === p.defaultSize ? " selected" : ""}" data-size="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      </div>
      ${teamSelect}
      <div class="card-actions"><button type="button" class="add-locker-btn">Add to locker • ${money(p.price)}</button></div>`
    : `<div class="card-actions"><a class="quickview-btn btn-block" href="${productUrl(p)}">Coming soon — get notified</a></div>`;
  return `
<article class="product-card" data-product="${p.id}" data-teams="${p.teams.join(" ")}" data-cat="${p.category}" data-search="${esc(search)}">
  <a class="product-img-wrap" href="${productUrl(p)}">
    ${p.available ? "" : '<div class="card-badges-top"><span class="soon-pill">Coming soon</span></div>'}
    <img class="product-img" src="${p.image}" alt="${esc(p.title)}" loading="lazy" width="300" height="220">
  </a>
  <div class="product-body">
    <div class="product-meta-row"><span>${esc(p.brand)}</span></div>
    <h3 class="product-title"><a href="${productUrl(p)}">${esc(p.name)}</a></h3>
    <div class="product-price-row">${p.available ? `<span class="price-now">${money(p.price)}</span>` : '<span class="price-soon">Launching soon</span>'}</div>
    ${buy}
  </div>
</article>`;
}

const grid = list => `<div class="product-grid" id="product-grid">${sorted(list).map(productCard).join("")}</div>`;

function breadcrumbs(items) {
  const html = `<nav class="breadcrumbs container" aria-label="Breadcrumb">${items.map((it, i) => i < items.length - 1 ? `<a href="${it.path}">${esc(it.name)}</a> /` : `<span>${esc(it.name)}</span>`).join(" ")}</nav>`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) }))
  };
  return { html, schema };
}

function listingPage({ path, title, description, h1, intro, products, crumbs, image }) {
  const bc = breadcrumbs(crumbs);
  const soon = products.some(p => !p.available);
  const body = `
${bc.html}
<section class="page-hero"><div class="container">
  <h1 class="page-title">${esc(h1)}</h1>
  <p class="page-intro">${esc(intro)}</p>
</div></section>
<section class="catalog-section"><div class="container">
  ${grid(products)}
  ${soon ? `<div class="notify-band">${notifyForm(null)}</div>` : ""}
</div></section>`;
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: sorted(products).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: abs(productUrl(p)), name: p.title }))
  };
  page(path, layout({ path, title, description, body, image, schema: [bc.schema, itemList] }));
}

/* ---------------- Pages ---------------- */

function homePage() {
  const path = "/";
  const hat = PRODUCTS.find(p => p.id === "eagles-kelly-green-59fifty");
  const dunk = PRODUCTS.find(p => p.id === "nike-dunk-low-philly-kelly-green");
  const hoodie = PRODUCTS.find(p => p.id === "foco-nfl-team-hoodie");
  const triple = [
    [hat, "badge-gold", "Kelly Green fitted"],
    [dunk, "badge-emerald", "Green & white Dunks"],
    [hoodie, "badge-crimson", "Pick your team"]
  ].map(([p, badge, tag]) => `
      <a class="triple-card" href="${productUrl(p)}">
        <img class="triple-card-thumb" src="${p.image}" alt="${esc(p.name)}">
        <div><span class="triple-card-badge ${badge}">${tag}</span><h3>${esc(p.name)}</h3><p><span class="price-highlight">${money(p.price)}</span></p></div>
      </a>`).join("");

  const teamPills = `<button type="button" class="team-pill active" data-team-filter="all">All teams</button>` +
    teamsWithProducts.map(t => `<button type="button" class="team-pill" data-team-filter="${t}"><span class="team-dot" style="background:${TEAMS[t].color}"></span>${esc(TEAMS[t].short)}</button>`).join("");
  const catPills = `<button type="button" class="team-pill active" data-cat-filter="all">Everything</button>` +
    Object.entries(CATEGORIES).map(([k, c]) => `<button type="button" class="team-pill" data-cat-filter="${k}">${esc(c.label)}</button>`).join("");

  const bento = Object.values(CATEGORIES).map(c => `
      <a class="bento-tile" href="${c.path}">
        <div><h3>${esc(c.label)}</h3><p>${esc(c.intro.split(". ")[0].replace(/\.$/, ""))}.</p></div>
        <span class="bento-tile-cta">Shop ${esc(c.label)} →</span>
      </a>`).join("");

  const opt = list => list.map(p => `<option value="${p.id}">${esc(p.name)} — ${money(p.price)}</option>`).join("");
  const kicks = live.filter(p => p.category === "sneakers");
  const tops = live.filter(p => p.category === "fan-gear" && p.sizeType === "apparel");
  const hats = live.filter(p => p.category === "fitted-hats");
  const step = (slot, label, list, extra = "") => `
      <div class="bundle-step-card">
        <span class="step-badge">${label}</span>
        <select class="bundle-select" id="bundle-${slot}" aria-label="${label}">${opt(list)}</select>
        ${extra}
        <select class="bundle-select" id="bundle-${slot}-size" aria-label="${label} size"></select>
        <div class="bundle-preview-box"><img id="bundle-${slot}-img" src="" alt=""><strong id="bundle-${slot}-price"></strong></div>
      </div>`;

  const faq = [
    ["Is everything authentic?", "Yes. Hoodies, sweaters, slides and New Era fitteds are officially licensed products. Every pair of sneakers is checked for authenticity before it ships, and if anything we sell turns out not to be genuine you get a full refund."],
    ["When will Mitchell & Ness jerseys be available?", "Soon. Join the launch list on any jersey page and we'll email you the day it goes live."],
    ["How fast does it ship?", `${SITE.dispatch}. Shipping is free on orders over $${SITE.freeShippingMin} and $${SITE.flatShipping.toFixed(2)} otherwise.`],
    ["Do you charge New Jersey sales tax?", "New Jersey doesn't tax most clothing and footwear, so NJ orders of these items have no sales tax. Any tax that applies is shown at checkout before you pay."],
    ["How does the bundle discount work?", `Put any ${SITE.bundleMinItems} or more items in your locker and ${SITE.bundlePercent}% comes off at checkout automatically.`]
  ];
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } }))
  };

  const body = `
<section class="hero-section"><div class="container hero-grid">
  <div>
    <span class="hero-eyebrow">Philly &amp; New York game-day gear</span>
    <h1 class="hero-headline">Philly throwbacks, <span class="gold-text">59FIFTY fitteds</span> &amp; authenticated kicks</h1>
    <p class="hero-subheadline">Kelly Green Eagles fitteds, Phillies Cooperstown caps, team-color Dunks and Jordans, and officially licensed hoodies and sweaters. Free shipping over $${SITE.freeShippingMin}, and ${SITE.bundlePercent}% off when you build a 3-piece fit.</p>
    <div class="hero-cta-row">
      <a class="btn-gold" href="${teamUrl("eagles")}">Shop Eagles</a>
      <a class="btn-outline-white" href="/sneakers/">Shop sneakers</a>
    </div>
    <p class="hero-note">Mitchell &amp; Ness throwback jerseys are launching soon — <a href="/throwback-jerseys/">join the list</a>.</p>
  </div>
  <div class="hero-triple-play">${triple}</div>
</div></section>

<section class="trust-strip"><div class="container trust-strip-grid">
  <div class="trust-pillar"><div><h4>Officially licensed</h4><p>FOCO and New Era licensed team gear.</p></div></div>
  <div class="trust-pillar"><div><h4>Authenticity checked</h4><p>Every sneaker is verified before it ships.</p></div></div>
  <div class="trust-pillar"><div><h4>Free shipping $${SITE.freeShippingMin}+</h4><p>${esc(SITE.dispatch)}.</p></div></div>
  <div class="trust-pillar"><div><h4>Secure checkout</h4><p>Card, Apple Pay and Google Pay via Stripe.</p></div></div>
</div></section>

<section class="bento-section"><div class="container"><div class="bento-grid">${bento}</div></div></section>

<section class="team-bar-section" id="catalog-anchor"><div class="container">
  <div class="section-header-row"><h2 class="section-title">Shop the locker</h2><span class="filter-status-text" id="filter-status-text">Showing all ${PRODUCTS.length} items</span></div>
  <div class="team-pills-row" aria-label="Filter by team">${teamPills}</div>
  <div class="team-pills-row" aria-label="Filter by category">${catPills}</div>
</div></section>
<section class="catalog-section"><div class="container">
  ${grid(PRODUCTS)}
  <p class="no-results" id="no-results" hidden>Nothing matches that search. Try a team name, a player or "Jordan".</p>
</div></section>

<section class="bundle-section" id="bundle-builder-section"><div class="container">
  <div class="bundle-header">
    <div><h2>Match your kicks: <span>${SITE.bundlePercent}% off any 3 pieces</span></h2>
    <p>Pick sneakers, a top and a fitted. The discount applies automatically at checkout.</p></div>
    <div class="bundle-presets">
      <button type="button" class="preset-btn" data-preset="philly">Philly Kelly Green</button>
      <button type="button" class="preset-btn" data-preset="sixers">Sixers + Jordan 1</button>
      <button type="button" class="preset-btn" data-preset="knicks">Knicks orange &amp; royal</button>
      <button type="button" class="preset-btn" data-preset="ravens">Ravens + Jordan 4</button>
    </div>
  </div>
  <div class="bundle-builder-grid">
    ${step("kick", "1 · Kicks", kicks)}
    ${step("top", "2 · Top", tops, '<select class="bundle-select" id="bundle-top-team" aria-label="Team"></select>')}
    ${step("hat", "3 · Fitted", hats)}
    <div class="bundle-summary-card">
      <div class="summary-row"><span>3 items</span><span id="bundle-reg-total"></span></div>
      <div class="summary-row discount"><span>${SITE.bundlePercent}% off</span><span id="bundle-discount-amt"></span></div>
      <div class="summary-row total"><span>Bundle</span><span id="bundle-final-total"></span></div>
      <button type="button" class="btn-gold btn-block" id="bundle-add-btn">Add all 3 to locker</button>
    </div>
  </div>
</div></section>

<section class="faq-section"><div class="container">
  <h2 class="section-title">Questions</h2>
  ${faq.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
</div></section>`;

  const org = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: abs("/assets/pressbox-crest-logo.png"),
    email: SITE.email,
    sameAs: [`https://instagram.com/${SITE.instagram}`]
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    potentialAction: { "@type": "SearchAction", target: `${SITE.url}/?q={search_term_string}`, "query-input": "required name=search_term_string" }
  };

  page(path, layout({
    path,
    pageName: "home",
    title: "Press Box Kicks & Jerseys | Eagles, Sixers & Phillies Throwbacks, 59FIFTY Fitteds & Sneakers",
    description: "Shop Philly and New York game-day gear: Eagles Kelly Green 59FIFTY fitteds, Phillies Cooperstown caps, Jordan and Nike Dunk sneakers, and officially licensed FOCO hoodies. Free shipping over $150.",
    body,
    schema: [org, website, faqSchema]
  }));
}

function productPage(p) {
  const path = productUrl(p);
  const cat = CATEGORIES[p.category];
  const crumbs = [{ name: "Home", path: "/" }, { name: cat.label, path: cat.path }, { name: p.name, path }];
  const bc = breadcrumbs(crumbs);
  const related = sorted(PRODUCTS.filter(x => x.id !== p.id && x.available && (x.teams.some(t => p.teams.includes(t)) || x.category === p.category))).slice(0, 4);
  const teamNames = p.teams.map(t => TEAMS[t].name);

  const details = [
    ["Brand", p.brand],
    ["Style / SKU", p.sku],
    teamNames.length ? ["Team", p.teamOptions ? p.teamOptions.join(", ") : teamNames.join(", ")] : null,
    ["Sizes", p.sizes.join(", ")],
    ["Shipping", p.available ? `${SITE.dispatch}. Free over $${SITE.freeShippingMin}.` : "Launching soon"],
    ["Returns", "30 days on unworn items — see shipping & returns"]
  ].filter(Boolean);

  const buy = p.available
    ? `<div class="product-price-row"><span class="price-now">${money(p.price)}</span></div>
       <div class="card-size-selector">
         <div class="card-size-label"><span>${sizeLabel(p)}</span><strong data-chosen-size>${esc(p.defaultSize)}</strong></div>
         <div class="card-size-pills">${p.sizes.map(s => `<button type="button" class="card-size-btn${s === p.defaultSize ? " selected" : ""}" data-size="${esc(s)}">${esc(s)}</button>`).join("")}</div>
       </div>
       ${p.teamOptions ? `<label class="field-label">Team<select class="team-select"><option value="">Choose team…</option>${p.teamOptions.map(t => `<option>${esc(t)}</option>`).join("")}</select></label>` : ""}
       <button type="button" class="btn-gold btn-block add-locker-btn">Add to locker • ${money(p.price)}</button>
       <p class="pdp-perk">Add any ${SITE.bundleMinItems} items and get ${SITE.bundlePercent}% off automatically.</p>`
    : `<p class="price-soon">Launching soon</p>
       <p>This jersey isn't available to order yet. Leave your email and we'll let you know the day it goes live.</p>
       ${notifyForm(p)}`;

  const body = `
${bc.html}
<section class="pdp container" data-product="${p.id}">
  <div class="pdp-media"><img src="${p.image}" alt="${esc(p.title)}" width="600" height="600"></div>
  <div class="pdp-info">
    <div class="product-meta-row"><span>${esc(p.brand)}</span>${p.available ? "" : '<span class="soon-pill">Coming soon</span>'}</div>
    <h1 class="pdp-title">${esc(p.title)}</h1>
    <p class="pdp-blurb">${esc(p.blurb)}</p>
    ${buy}
    <dl class="pdp-details">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
  </div>
</section>
${related.length ? `<section class="catalog-section"><div class="container"><h2 class="section-title">Complete the fit</h2><div class="product-grid">${related.map(productCard).join("")}</div></div></section>` : ""}`;

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: abs(p.image),
    description: p.blurb,
    sku: p.sku,
    brand: { "@type": "Brand", name: p.brand },
    offers: {
      "@type": "Offer",
      url: abs(path),
      priceCurrency: "USD",
      price: p.price.toFixed(2),
      availability: p.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: SITE.name }
    }
  };

  page(path, layout({
    path,
    title: `${p.title}${p.available ? ` | ${money(p.price)}` : " | Coming Soon"} | Press Box`,
    description: p.available
      ? `${p.title}. ${p.blurb} ${money(p.price)}, free shipping over $${SITE.freeShippingMin}.`
      : `${p.title} — launching soon at Press Box Kicks & Jerseys. Join the list to be notified.`,
    body,
    image: p.image,
    schema: [productSchema, bc.schema]
  }));
}

function teamPage(slug) {
  const t = TEAMS[slug];
  const products = PRODUCTS.filter(p => p.teams.includes(slug));
  const path = teamUrl(slug);
  const liveCount = products.filter(p => p.available).length;
  listingPage({
    path,
    title: `${t.name} Throwbacks, Fitted Hats & Gear | Press Box Kicks & Jerseys`,
    description: `Shop ${t.name} gear: ${products.slice(0, 3).map(p => p.name).join(", ")} and more. Free shipping over $${SITE.freeShippingMin}.`,
    h1: `${t.name} Gear`,
    intro: `${liveCount} ${t.short} item${liveCount === 1 ? "" : "s"} ready to ship${products.length > liveCount ? `, plus Mitchell & Ness ${t.short} throwbacks launching soon` : ""}.`,
    products,
    crumbs: [{ name: "Home", path: "/" }, { name: t.name, path }],
    image: sorted(products)[0]?.image
  });
}

function categoryPage(key) {
  const c = CATEGORIES[key];
  const products = PRODUCTS.filter(p => p.category === key);
  listingPage({
    path: c.path,
    title: `${c.h1} | Press Box Kicks & Jerseys`,
    description: c.intro.slice(0, 155),
    h1: c.h1,
    intro: c.intro,
    products,
    crumbs: [{ name: "Home", path: "/" }, { name: c.label, path: c.path }],
    image: sorted(products)[0]?.image
  });
}

function landingPage(l) {
  const products = PRODUCTS.filter(l.match);
  listingPage({
    path: l.path,
    title: l.title,
    description: l.description,
    h1: l.h1,
    intro: l.intro,
    products,
    crumbs: [{ name: "Home", path: "/" }, { name: l.h1, path: l.path }],
    image: sorted(products)[0]?.image
  });
}

function textPage(path, title, description, html, opts = {}) {
  page(path, layout({
    path, title, description, pageName: opts.pageName || "",
    noindex: !!opts.noindex,
    body: `<section class="text-page container">${html}</section>`
  }), { sitemap: !opts.noindex });
}

function infoPages() {
  textPage("/shipping-returns/", "Shipping, Returns & Authenticity | Press Box Kicks & Jerseys",
    "Shipping times, free shipping over $150, 30-day returns on unworn items and how we check authenticity.", `
<h1 class="page-title">Shipping, returns &amp; authenticity</h1>
<h2>Shipping</h2>
<p>${esc(SITE.dispatch)} to any US address. Shipping is free on orders over $${SITE.freeShippingMin} (after discounts) and $${SITE.flatShipping.toFixed(2)} otherwise. You'll get a tracking number by email when your order ships. Some orders ship in more than one package.</p>
<h2>Returns</h2>
<p>Return unworn, unwashed items with original tags (and sneakers in their original box) within 30 days of delivery for a refund to your original payment method. Email <a href="mailto:${SITE.email}">${SITE.email}</a> with your order number to start a return. Return shipping is paid by the customer unless we sent the wrong item or it arrived damaged. Custom-embroidered caps are final sale.</p>
<h2 id="authenticity">Authenticity</h2>
<p>Hoodies, sweaters, slides and New Era fitteds are officially licensed products. Every pair of sneakers is checked for authenticity before it ships. If anything you buy from us turns out not to be genuine, we'll refund you in full.</p>
<h2>Sales tax</h2>
<p>Any sales tax that applies is calculated and shown at checkout before you pay. New Jersey doesn't tax most clothing and footwear.</p>`);

  textPage("/contact/", "Contact | Press Box Kicks & Jerseys", "Questions about an order, sizing or a launch? Email Press Box Kicks & Jerseys.", `
<h1 class="page-title">Contact us</h1>
<p>Email <a href="mailto:${SITE.email}">${SITE.email}</a> — we answer within one business day. Include your order number if you have one.</p>
<p>Instagram: <a href="https://instagram.com/${SITE.instagram}" rel="noopener">@${SITE.instagram}</a></p>
<p>${esc(SITE.legalName)}, doing business as ${esc(SITE.name)}.</p>`);

  textPage("/order-confirmed/", "Order confirmed | Press Box Kicks & Jerseys", "Thanks for your order.", `
<h1 class="page-title">You're locked in. Thanks for your order!</h1>
<p>A receipt is on its way to your email. We'll send tracking as soon as your order ships (${esc(SITE.dispatch.toLowerCase())}).</p>
<p>Questions? Email <a href="mailto:${SITE.email}">${SITE.email}</a>.</p>
<p><a class="btn-gold" href="/">Keep shopping</a></p>`, { noindex: true, pageName: "order-confirmed" });

  textPage("/notify-thanks/", "You're on the list | Press Box Kicks & Jerseys", "We'll email you when it launches.", `
<h1 class="page-title">You're on the list.</h1>
<p>We'll email you as soon as it's available. In the meantime, the fitteds, sneakers and team gear below ship now.</p>
<p><a class="btn-gold" href="/">Back to the shop</a></p>`, { noindex: true });

  write("/404.html", layout({
    path: "/404.html", title: "Page not found | Press Box Kicks & Jerseys", description: "Page not found.", noindex: true,
    body: `<section class="text-page container"><h1 class="page-title">That page fumbled.</h1><p>It may have moved. <a href="/">Head back to the shop</a> or search above.</p></section>`
  }));
}

/* ---------------- Assets & metadata ---------------- */

function staticFiles() {
  copyFileSync(join(ROOT, "static", "styles.css"), join(OUT, "styles.css"));
  copyFileSync(join(ROOT, "static", "site.js"), join(OUT, "site.js"));
  // Real images dropped into ./assets are deployed; anything missing is proxied
  // from the original deploy by the /assets/* rule in netlify.toml.
  const assetDir = join(ROOT, "assets");
  if (existsSync(assetDir)) {
    mkdirSync(join(OUT, "assets"), { recursive: true });
    for (const f of readdirSync(assetDir)) copyFileSync(join(assetDir, f), join(OUT, "assets", f));
  }
  const pub = PRODUCTS.map(({ id, name, price, image, sizes, defaultSize, teamOptions, available, category, sizeType }) =>
    ({ id, name, price, image, sizes, defaultSize, teamOptions, available, category, sizeType }));
  const site = { email: SITE.email, freeShippingMin: SITE.freeShippingMin, flatShipping: SITE.flatShipping, bundleMinItems: SITE.bundleMinItems, bundlePercent: SITE.bundlePercent };
  writeFileSync(join(OUT, "catalog.js"), `window.PB=${JSON.stringify({ products: pub, site })};\n`);

  writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /order-confirmed/\nDisallow: /notify-thanks/\n\nSitemap: ${SITE.url}/sitemap.xml\n`);
  writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${abs(p)}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join("\n")}
</urlset>
`);
}

/* ---------------- Run ---------------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
homePage();
PRODUCTS.forEach(productPage);
teamsWithProducts.forEach(teamPage);
Object.keys(CATEGORIES).forEach(categoryPage);
LANDING_PAGES.forEach(landingPage);
infoPages();
staticFiles();
console.log(`Built ${pages.length} indexable pages into dist/`);
