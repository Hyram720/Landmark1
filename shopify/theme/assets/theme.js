// Sun Atelier: menu, homepage tabs, product variant picker, gallery thumbnails.
(() => {
  // Mobile menu
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.getElementById('SiteNav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Catalog tabs
  document.querySelectorAll('[data-tabs]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          const selected = t === tab;
          t.setAttribute('aria-selected', String(selected));
          const panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !selected;
        });
      });
    });
  });

  // Variant picker, shared by the product page and the Custom Studio.
  window.SunVariantPicker = function (root, onChange) {
    const json = root.querySelector('[data-product-json]');
    const idInput = root.querySelector('[data-variant-id]');
    if (!json || !idInput) return;
    const variants = JSON.parse(json.textContent);
    const price = root.querySelector('[data-price]');
    const button = root.querySelector('[data-add-button]');
    const format = (cents) =>
      new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: window.Shopify?.currency?.active || 'USD' }).format(cents / 100);

    function update() {
      const selected = [...root.querySelectorAll('[data-option]:checked')]
        .sort((a, b) => a.dataset.option - b.dataset.option)
        .map((el) => el.value);
      const variant = variants.find((v) => v.options.every((o, i) => o === selected[i]));
      if (!variant) {
        if (button) button.disabled = true;
        return;
      }
      idInput.value = variant.id;
      if (price) price.textContent = format(variant.price);
      if (button) button.disabled = !variant.available;
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
      if (variant.featured_image) {
        const main = root.querySelector('[data-main-image]');
        if (main) { main.srcset = ''; main.src = variant.featured_image.src; }
      }
      if (onChange) onChange(variant);
    }
    root.querySelectorAll('[data-option]').forEach((el) => el.addEventListener('change', update));
    return { update, variants };
  };

  document.querySelectorAll('[data-product]').forEach((root) => {
    window.SunVariantPicker(root);
    const main = root.querySelector('[data-main-image]');
    root.querySelectorAll('[data-thumb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!main) return;
        main.srcset = '';
        main.src = btn.dataset.thumb;
        root.querySelectorAll('[data-thumb]').forEach((b) => b.setAttribute('aria-current', String(b === btn)));
      });
    });
  });
})();
