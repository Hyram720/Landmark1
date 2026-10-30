// Custom Studio: live garment preview, Studio Library, background remover, DPI check.
(() => {
  const root = document.querySelector('[data-studio]');
  if (!root) return;
  const config = JSON.parse(root.querySelector('[data-studio-config]').textContent);
  const $ = (sel) => root.querySelector(sel);

  const stage = $('[data-stage]');
  const garment = $('[data-garment]');
  const art = $('[data-art]');
  const artName = $('[data-art-name]');
  const dpiLabel = $('[data-dpi]');
  const upload = $('[data-upload]');
  const libraryInput = $('[data-library-input]');
  const placementInput = $('[data-placement-input]');
  const bgInput = $('[data-bg-input]');
  const scale = $('[data-scale]');
  const rotate = $('[data-rotate]');
  const tolerance = $('[data-tolerance]');
  const restoreBtn = $('[data-restore]');
  const removeBtn = $('[data-remove-bg]');
  const error = $('[data-error]');

  let originalFile = null; // the customer's untouched upload, for "Restore original"
  let naturalWidth = 0;

  // ---- Garment shape + colour follow the Style / Color options ----
  function syncGarment(variant) {
    const opts = [...root.querySelectorAll('[data-option]:checked')];
    const style = (opts.find((o) => o.dataset.optionName === 'style') || {}).value || '';
    const color = ((opts.find((o) => o.dataset.optionName === 'color') || {}).value || '').toLowerCase();
    const shape = /hoodie/i.test(style) ? 'hoodie' : /tote/i.test(style) ? 'tote' : 'tee';
    garment.querySelectorAll('[data-shape]').forEach((svg) => svg.toggleAttribute('hidden', svg.dataset.shape !== shape));
    garment.style.color = config.colors[color] || '#17181b';
    if (variant) updateDpi();
  }
  window.SunVariantPicker(root, syncGarment);
  syncGarment();

  // ---- Art loading ----
  function showArt(src, name) {
    art.onload = () => {
      naturalWidth = art.naturalWidth;
      updateDpi();
    };
    art.src = src;
    art.hidden = false;
    artName.textContent = name;
    error.hidden = true;
  }

  function updateDpi() {
    if (!naturalWidth) { dpiLabel.textContent = ''; return; }
    const inches = (config.printWidthInches * Number(scale.value)) / 100;
    const dpi = Math.round(naturalWidth / inches);
    const low = dpi < 300;
    dpiLabel.textContent = (low ? config.strings.dpiLow : config.strings.dpiOk).replace('__DPI__', dpi);
    dpiLabel.classList.toggle('dpi--low', low);
  }

  function updatePlacement() {
    $('[data-scale-label]').textContent = scale.value;
    $('[data-rotate-label]').textContent = rotate.value;
    art.style.transform = `scale(${scale.value / 100}) rotate(${rotate.value}deg)`;
    placementInput.value = `${config.printWidthInches}" wide chest print at ${scale.value}% scale, ${rotate.value}° rotation`;
    updateDpi();
  }
  scale.addEventListener('input', updatePlacement);
  rotate.addEventListener('input', updatePlacement);
  updatePlacement();

  function setUploadFile(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    upload.files = dt.files;
  }

  upload.addEventListener('change', () => {
    const file = upload.files[0];
    if (!file) return;
    originalFile = file;
    bgInput.value = 'No';
    restoreBtn.hidden = true;
    removeBtn.disabled = file.type === 'image/svg+xml';
    clearLibrary();
    showArt(URL.createObjectURL(file), file.name);
  });

  // ---- Studio Library ----
  const libraryButtons = [...root.querySelectorAll('[data-library]')];
  function clearLibrary() {
    libraryButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    libraryInput.value = '';
    libraryInput.disabled = true;
  }
  libraryButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      clearLibrary();
      btn.setAttribute('aria-pressed', 'true');
      libraryInput.value = btn.dataset.title;
      libraryInput.disabled = false;
      upload.value = '';
      originalFile = null;
      restoreBtn.hidden = true;
      removeBtn.disabled = true; // library art already has a transparent background
      showArt(btn.dataset.library, btn.dataset.title);
    });
  });

  // ---- Clear + view toggle ----
  $('[data-clear]').addEventListener('click', () => {
    clearLibrary();
    upload.value = '';
    originalFile = null;
    naturalWidth = 0;
    art.hidden = true;
    art.removeAttribute('src');
    artName.textContent = config.strings.needArt;
    restoreBtn.hidden = true;
    removeBtn.disabled = false;
    bgInput.value = 'No';
    updateDpi();
  });

  const viewToggle = $('[data-view-toggle]');
  viewToggle.addEventListener('click', () => {
    const artOnly = stage.classList.toggle('stage--art-only');
    viewToggle.textContent = artOnly ? config.strings.garmentView : config.strings.artOnly;
  });

  // ---- Background remover: flood-fill from the edges, keyed to the corner colour ----
  removeBtn.addEventListener('click', async () => {
    const file = upload.files[0];
    if (!file) { error.hidden = false; return; }
    removeBtn.disabled = true;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      floodRemove(img, Number(tolerance.value));
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const name = file.name.replace(/\.[^.]+$/, '') + '-transparent.png';
      setUploadFile(new File([blob], name, { type: 'image/png' }));
      bgInput.value = 'Yes';
      restoreBtn.hidden = false;
      showArt(URL.createObjectURL(blob), name);
    } finally {
      removeBtn.disabled = false;
    }
  });

  restoreBtn.addEventListener('click', () => {
    if (!originalFile) return;
    setUploadFile(originalFile);
    bgInput.value = 'No';
    restoreBtn.hidden = true;
    showArt(URL.createObjectURL(originalFile), originalFile.name);
  });

  function floodRemove(img, tol) {
    const { data, width, height } = img;
    const key = [data[0], data[1], data[2]];
    const tol2 = tol * tol * 3;
    const seen = new Uint8Array(width * height);
    const stack = [];
    for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
    const near = (i) => {
      const dr = data[i * 4] - key[0], dg = data[i * 4 + 1] - key[1], db = data[i * 4 + 2] - key[2];
      return dr * dr + dg * dg + db * db <= tol2;
    };
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      if (!near(p)) continue;
      data[p * 4 + 3] = 0;
      const x = p % width;
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (p >= width) stack.push(p - width);
      if (p < width * (height - 1)) stack.push(p + width);
    }
    // Soften the cut edge: half-transparent for opaque pixels touching a cleared one.
    for (let p = 0; p < width * height; p++) {
      if (data[p * 4 + 3] === 0) continue;
      const x = p % width;
      const n = [x > 0 && p - 1, x < width - 1 && p + 1, p >= width && p - width, p < width * (height - 1) && p + width];
      if (n.some((q) => q !== false && data[q * 4 + 3] === 0 && seen[q])) data[p * 4 + 3] = 128;
    }
  }

  // ---- Require art before adding to the bag ----
  $('[data-studio-form]').addEventListener('submit', (e) => {
    if (!upload.files.length && libraryInput.disabled) {
      e.preventDefault();
      error.hidden = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
})();
