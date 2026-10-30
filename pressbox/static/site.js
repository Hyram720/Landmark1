// Press Box storefront behaviour. Product cards are rendered at build time;
// this file adds sizes, the locker (cart), filters, the bundle builder and
// checkout. Catalog data comes from /catalog.js (window.PB).

(function () {
  const { products, site } = window.PB;
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  const KEY = "pb-locker-v2";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = n => "$" + n.toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Locker (cart) ---------- */
  function load() {
    try {
      const items = JSON.parse(localStorage.getItem(KEY)) || [];
      return items.filter(i => byId[i.id] && byId[i.id].available);
    } catch {
      return [];
    }
  }
  let cart = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* private mode: cart lives for this page only */
    }
  }

  function totals() {
    const qty = cart.reduce((n, i) => n + i.qty, 0);
    const subtotal = cart.reduce((n, i) => n + byId[i.id].price * i.qty, 0);
    const bundle = qty >= site.bundleMinItems;
    const discount = bundle ? subtotal * site.bundlePercent / 100 : 0;
    const total = subtotal - discount;
    const shipping = cart.length === 0 || total >= site.freeShippingMin ? 0 : site.flatShipping;
    return { qty, subtotal, bundle, discount, total, shipping };
  }

  function add(id, size, team) {
    const p = byId[id];
    if (!p || !p.available) return;
    if (p.teamOptions && !team) return;
    const hit = cart.find(i => i.id === id && i.size === size && (i.team || null) === (team || null));
    if (hit) hit.qty = Math.min(hit.qty + 1, 5);
    else cart.push({ id, size, team: team || null, qty: 1 });
    save();
    renderCart();
    openDrawer();
  }

  function changeQty(idx, delta) {
    const item = cart[idx];
    if (!item) return;
    item.qty = Math.min(item.qty + delta, 5);
    if (item.qty <= 0) cart.splice(idx, 1);
    save();
    renderCart();
  }

  function renderCart() {
    const t = totals();
    $$("[data-locker-count]").forEach(el => (el.textContent = t.qty));
    $$("[data-locker-total]").forEach(el => (el.textContent = money(t.total)));
    const list = $("#drawer-items-list");
    if (!list) return;

    list.innerHTML = cart.length
      ? cart.map((i, idx) => {
          const p = byId[i.id];
          return `
          <div class="drawer-item">
            <img src="${p.image}" alt="${esc(p.name)}">
            <div class="drawer-item-info">
              <a class="drawer-item-title" href="/products/${p.id}/">${esc(p.name)}</a>
              <div class="drawer-item-meta">${i.team ? esc(i.team) + " • " : ""}Size <strong>${esc(i.size)}</strong></div>
              <div class="drawer-qty-row">
                <div class="qty-controls">
                  <button type="button" class="qty-btn" data-qty="${idx}:-1" aria-label="Remove one">−</button>
                  <span>${i.qty}</span>
                  <button type="button" class="qty-btn" data-qty="${idx}:1" aria-label="Add one">+</button>
                </div>
                <strong>${money(p.price * i.qty)}</strong>
              </div>
            </div>
          </div>`;
        }).join("")
      : `<div class="drawer-empty">
           <p><strong>Your locker is empty.</strong></p>
           <p>Add any ${site.bundleMinItems} items and ${site.bundlePercent}% comes off automatically.</p>
         </div>`;

    $("#drawer-subtotal").textContent = money(t.subtotal);
    $("#drawer-discount-row").style.display = t.bundle ? "flex" : "none";
    $("#drawer-discount-val").textContent = "−" + money(t.discount);
    $("#drawer-shipping").textContent = cart.length === 0 ? "—" : t.shipping ? money(t.shipping) : "FREE";
    $("#drawer-grand-total").textContent = money(t.total + t.shipping);
    const remaining = site.freeShippingMin - t.total;
    $("#drawer-perk").textContent = cart.length && remaining > 0
      ? `Add ${money(remaining)} more for free shipping.`
      : cart.length ? "You've unlocked free shipping." : `Free shipping over $${site.freeShippingMin} • ${site.bundlePercent}% off any ${site.bundleMinItems}+ items`;
    $("#checkout-btn").disabled = cart.length === 0;
  }

  function openDrawer() {
    $("#drawer-backdrop")?.classList.add("open");
    $("#locker-drawer")?.classList.add("open");
  }
  function closeDrawer() {
    $("#drawer-backdrop")?.classList.remove("open");
    $("#locker-drawer")?.classList.remove("open");
  }

  async function checkout() {
    const btn = $("#checkout-btn");
    const msg = $("#checkout-msg");
    btn.disabled = true;
    btn.textContent = "Opening secure checkout…";
    msg.textContent = "";
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: cart })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      msg.textContent = data.error || "Checkout couldn't start. Please try again.";
    } catch {
      msg.textContent = `Checkout couldn't start. Check your connection or email ${site.email}.`;
    }
    btn.disabled = false;
    btn.textContent = "Secure checkout";
  }

  /* ---------- Product cards ---------- */
  function cardChoice(card) {
    const size = $(".card-size-btn.selected", card)?.dataset.size;
    const team = $(".team-select", card)?.value || null;
    return { size, team };
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("button, [data-open-locker]");
    if (!t) return;

    if (t.matches(".card-size-btn")) {
      const card = t.closest("[data-product]");
      $$(".card-size-btn", card).forEach(b => b.classList.toggle("selected", b === t));
      const label = $("[data-chosen-size]", card);
      if (label) label.textContent = t.dataset.size;
    } else if (t.matches(".add-locker-btn")) {
      const card = t.closest("[data-product]");
      const { size, team } = cardChoice(card);
      const p = byId[card.dataset.product];
      if (p.teamOptions && !team) {
        $(".team-select", card).focus();
        return;
      }
      add(p.id, size, team);
    } else if (t.matches("[data-open-locker]")) {
      openDrawer();
    } else if (t.matches("[data-close-locker]")) {
      closeDrawer();
    } else if (t.dataset.qty) {
      const [idx, d] = t.dataset.qty.split(":").map(Number);
      changeQty(idx, d);
    } else if (t.id === "checkout-btn") {
      checkout();
    } else if (t.dataset.teamFilter !== undefined) {
      filters.team = t.dataset.teamFilter;
      $$("[data-team-filter]").forEach(b => b.classList.toggle("active", b === t));
      applyFilters(true);
    } else if (t.dataset.catFilter !== undefined) {
      filters.cat = t.dataset.catFilter;
      $$("[data-cat-filter]").forEach(b => b.classList.toggle("active", b === t));
      applyFilters(true);
    } else if (t.dataset.preset) {
      applyPreset(t.dataset.preset);
    } else if (t.id === "bundle-add-btn") {
      addBundle();
    }
  });

  $("#drawer-backdrop")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => e.key === "Escape" && closeDrawer());

  /* ---------- Homepage filters ---------- */
  const filters = { team: "all", cat: "all", q: "" };

  function applyFilters(scroll) {
    const cards = $$("#product-grid [data-product]");
    if (!cards.length) return;
    let shown = 0;
    cards.forEach(card => {
      const ok =
        (filters.team === "all" || card.dataset.teams.split(" ").includes(filters.team)) &&
        (filters.cat === "all" || card.dataset.cat === filters.cat) &&
        (!filters.q || card.dataset.search.includes(filters.q));
      card.hidden = !ok;
      if (ok) shown++;
    });
    const status = $("#filter-status-text");
    if (status) status.textContent = shown === cards.length ? `Showing all ${shown} items` : `Showing ${shown} of ${cards.length} items`;
    $("#no-results").hidden = shown !== 0;
    if (scroll) $("#catalog-anchor")?.scrollIntoView({ behavior: "smooth" });
  }

  $("#main-search-input")?.addEventListener("input", e => {
    filters.q = e.target.value.trim().toLowerCase();
    applyFilters(false);
  });
  $("#search-form")?.addEventListener("submit", e => {
    if (!$("#product-grid")) return; // other pages: let the form go to the homepage
    e.preventDefault();
    applyFilters(true);
  });
  const q = new URLSearchParams(location.search).get("q");
  if (q && $("#main-search-input")) {
    $("#main-search-input").value = q;
    filters.q = q.toLowerCase();
    applyFilters(true);
  }

  /* ---------- Bundle builder ---------- */
  const PRESETS = {
    philly: { kick: "nike-dunk-low-philly-kelly-green", top: "foco-nfl-team-hoodie", topTeam: "Eagles", hat: "eagles-kelly-green-59fifty" },
    sixers: { kick: "air-jordan-1-high-og-lost-and-found", top: "foco-nfl-team-hoodie", topTeam: "76ers", hat: "phillies-1980-world-series-59fifty" },
    knicks: { kick: "nike-dunk-low-knicks-orange-royal", top: "foco-nfl-team-hoodie", topTeam: "Knicks", hat: "yankees-1998-world-series-59fifty" },
    ravens: { kick: "air-jordan-4-midnight-navy", top: "foco-ravens-light-up-knit-sweater", hat: "ravens-super-bowl-xxxv-59fifty" }
  };

  function fillSizes(select, p, preferred) {
    select.innerHTML = p.sizes.map(s => `<option${s === (preferred || p.defaultSize) ? " selected" : ""}>${esc(s)}</option>`).join("");
  }

  function syncBundle() {
    const kick = byId[$("#bundle-kick").value];
    const top = byId[$("#bundle-top").value];
    const hat = byId[$("#bundle-hat").value];
    [["kick", kick], ["top", top], ["hat", hat]].forEach(([slot, p]) => {
      const sizeSel = $(`#bundle-${slot}-size`);
      if (sizeSel.dataset.for !== p.id) {
        fillSizes(sizeSel, p);
        sizeSel.dataset.for = p.id;
      }
      $(`#bundle-${slot}-img`).src = p.image;
      $(`#bundle-${slot}-img`).alt = p.name;
      $(`#bundle-${slot}-price`).textContent = money(p.price);
    });
    const teamSel = $("#bundle-top-team");
    if (top.teamOptions) {
      if (teamSel.dataset.for !== top.id) {
        teamSel.innerHTML = top.teamOptions.map(t => `<option>${esc(t)}</option>`).join("");
        teamSel.dataset.for = top.id;
      }
      teamSel.hidden = false;
    } else {
      teamSel.hidden = true;
    }
    const reg = kick.price + top.price + hat.price;
    const off = reg * site.bundlePercent / 100;
    $("#bundle-reg-total").textContent = money(reg);
    $("#bundle-discount-amt").textContent = "−" + money(off);
    $("#bundle-final-total").textContent = money(reg - off);
  }

  function applyPreset(name) {
    const pr = PRESETS[name];
    if (!pr) return;
    $("#bundle-kick").value = pr.kick;
    $("#bundle-top").value = pr.top;
    $("#bundle-hat").value = pr.hat;
    syncBundle();
    if (pr.topTeam) $("#bundle-top-team").value = pr.topTeam;
  }

  function addBundle() {
    const top = byId[$("#bundle-top").value];
    add($("#bundle-kick").value, $("#bundle-kick-size").value);
    add(top.id, $("#bundle-top-size").value, top.teamOptions ? $("#bundle-top-team").value : null);
    add($("#bundle-hat").value, $("#bundle-hat-size").value);
  }

  if ($("#bundle-kick")) {
    ["#bundle-kick", "#bundle-top", "#bundle-hat"].forEach(s => $(s).addEventListener("change", syncBundle));
    applyPreset("philly");
  }

  /* ---------- Page hooks ---------- */
  if (document.body.dataset.page === "order-confirmed") {
    cart = [];
    save();
  }
  if (new URLSearchParams(location.search).get("checkout") === "cancelled") {
    renderCart();
    openDrawer();
    $("#checkout-msg").textContent = "Checkout cancelled — your locker is saved.";
  }

  renderCart();
})();
