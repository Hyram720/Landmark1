// Local bag for the re-engineered storefront. Lines live in localStorage; uploaded
// artwork files live in IndexedDB (too large for localStorage). Checkout is not connected.
(() => {
  const KEY = 'scd-bag-v1';
  const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function write(lines) {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* storage full or blocked */ }
    renderCount();
  }
  function renderCount() {
    const n = read().reduce((sum, l) => sum + l.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = n; });
  }

  // ---- IndexedDB for artwork files ----
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('scd-artwork', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function putFile(id, file) {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put(file, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function getFile(id) {
    const d = await db();
    return new Promise((res) => {
      const req = d.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  }
  async function deleteFile(id) {
    try {
      const d = await db();
      d.transaction('files', 'readwrite').objectStore('files').delete(id);
    } catch { /* nothing stored */ }
  }

  // ---- Add to bag ----
  // Runs after the Studio's own submit check, which cancels the event when no art is chosen.
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-cart-form]');
    if (!form || e.defaultPrevented) return;
    e.preventDefault();
    const variants = JSON.parse(document.querySelector('[data-product-json]').textContent);
    const product = JSON.parse(document.querySelector('[data-product-meta]').textContent);
    const data = new FormData(form);
    const variant = variants.find((v) => String(v.id) === String(data.get('id')));
    if (!variant) return;

    const id = `${variant.id}-${Date.now()}`;
    const properties = {};
    let file = null;
    for (const [name, value] of data.entries()) {
      const m = /^properties\[(.+)\]$/.exec(name);
      if (!m) continue;
      if (value instanceof File) {
        if (value.size) { file = value; properties[m[1]] = value.name; }
      } else if (value !== '') {
        properties[m[1]] = value;
      }
    }
    if (file) {
      try { await putFile(id, file); } catch { properties._fileNotSaved = 'Yes'; }
    }
    const lines = read();
    lines.push({
      id, handle: product.handle, title: product.title, image: product.image,
      variantId: variant.id, variantTitle: variant.title, price: variant.price,
      qty: Math.max(1, Number(data.get('quantity')) || 1), properties, hasFile: Boolean(file),
    });
    write(lines);
    window.location.href = form.dataset.cartUrl;
  });

  // ---- Bag page ----
  async function renderPage(root) {
    const lines = read();
    const list = root.querySelector('[data-cart-lines]');
    const empty = root.querySelector('[data-cart-empty]');
    const footer = root.querySelector('[data-cart-footer]');
    empty.hidden = lines.length > 0;
    footer.hidden = lines.length === 0;
    list.innerHTML = '';
    for (const line of lines) {
      const props = Object.entries(line.properties)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="cart-item">
          ${line.image ? `<img src="${esc(line.image)}" alt="" width="88" height="110" data-thumb-for="${esc(line.id)}">` : ''}
          <div>
            <a href="${esc(root.dataset.productsUrl)}${esc(line.handle)}/" style="color:var(--text);font-weight:600">${esc(line.title)}</a>
            <div class="muted" style="font-size:14px">${esc(line.variantTitle)}</div>
            ${props ? `<ul class="cart-item__props">${props}</ul>` : ''}
            <button type="button" class="link-button" data-remove="${esc(line.id)}">Remove</button>
          </div>
        </div></td>
        <td>${money(line.price)}</td>
        <td><input type="number" min="0" value="${line.qty}" aria-label="Quantity" data-qty="${esc(line.id)}"></td>
        <td style="text-align:right">${money(line.price * line.qty)}</td>`;
      list.appendChild(tr);
      if (line.hasFile) {
        const file = await getFile(line.id);
        const img = tr.querySelector('[data-thumb-for]');
        if (file && img) img.src = URL.createObjectURL(file);
      }
    }
    root.querySelector('[data-cart-subtotal]').textContent = money(lines.reduce((s, l) => s + l.price * l.qty, 0));
  }

  function remove(id) {
    write(read().filter((l) => l.id !== id));
    deleteFile(id);
  }

  const page = document.querySelector('[data-cart-page]');
  if (page) {
    page.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) { remove(btn.dataset.remove); renderPage(page); }
    });
    page.addEventListener('change', (e) => {
      const input = e.target.closest('[data-qty]');
      if (!input) return;
      const qty = Math.max(0, Number(input.value) || 0);
      if (qty === 0) remove(input.dataset.qty);
      else write(read().map((l) => (l.id === input.dataset.qty ? { ...l, qty } : l)));
      renderPage(page);
    });
    renderPage(page);
  }
  renderCount();
})();
