(function () {
  // every write carries this header — the server refuses writes without it
  // (a plain cross-site form post can't set it), so another web page can't
  // change your files through this local server
  const baseFetch = window.fetch.bind(window);
  window.fetch = (url, options = {}) =>
    options.method && options.method !== "GET"
      ? baseFetch(url, { ...options, headers: { ...(options.headers || {}), "X-Requested-With": "editor" } })
      : baseFetch(url, options);

  if (location.protocol !== "http:" && location.protocol !== "https:") {
    // opened as a local file instead of through server.py — every fetch()
    // call below would fail, so bail out early with a clear explanation
    // instead of a confusing "can't reach the editor server" error
    document.getElementById("offlineNotice").hidden = false;
    return;
  }

  const form = document.getElementById("nodeForm");
  const formTitle = document.getElementById("formTitle");
  const formError = document.getElementById("formError");

  const fieldTitle = document.getElementById("fieldTitle");
  const fieldCategory = document.getElementById("fieldCategory");
  const fieldX = document.getElementById("fieldX");
  const fieldY = document.getElementById("fieldY");
  const fieldDescription = document.getElementById("fieldDescription");
  const fieldTags = document.getElementById("fieldTags");
  const fieldLink = document.getElementById("fieldLink");
  const fieldImage = document.getElementById("fieldImage");

  const imagePreviewWrap = document.getElementById("imagePreviewWrap");
  const imagePreview = document.getElementById("imagePreview");
  const imagePreviewRemove = document.getElementById("imagePreviewRemove");

  const miniChart = document.getElementById("miniChart");
  const miniChartExisting = document.getElementById("miniChartExisting");
  const miniChartTarget = document.getElementById("miniChartTarget");

  const submitBtn = document.getElementById("submitBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");

  const nodeList = document.getElementById("nodeList");
  const nodeCount = document.getElementById("nodeCount");

  const categoryList = document.getElementById("categoryList");
  const categoryCount = document.getElementById("categoryCount");
  const categoryForm = document.getElementById("categoryForm");
  const categoryName = document.getElementById("categoryName");
  const categoryColor = document.getElementById("categoryColor");
  const categoryError = document.getElementById("categoryError");

  const folderBar = document.getElementById("folderBar");
  const folderPath = document.getElementById("folderPath");
  const folderChangeBtn = document.getElementById("folderChangeBtn");
  const folderEditForm = document.getElementById("folderEditForm");
  const folderInput = document.getElementById("folderInput");
  const folderCancelBtn = document.getElementById("folderCancelBtn");
  const folderErrorEl = document.getElementById("folderError");

  const setupCard = document.getElementById("setupCard");
  const setupForm = document.getElementById("setupForm");
  const setupFolderInput = document.getElementById("setupFolderInput");
  const setupError = document.getElementById("setupError");
  const setupRecent = document.getElementById("setupRecent");
  const folderRecent = document.getElementById("folderRecent");

  const editorLayout = document.getElementById("editorLayout");

  const fieldDate = document.getElementById("fieldDate");
  const dateHint = document.getElementById("dateHint");
  const fieldShape = document.getElementById("fieldShape");
  const siteForm = document.getElementById("siteForm");
  const siteTitle = document.getElementById("siteTitle");
  const siteSubtitle = document.getElementById("siteSubtitle");
  const siteScheme = document.getElementById("siteScheme");
  const siteShape = document.getElementById("siteShape");
  const siteError = document.getElementById("siteError");
  const mapForm = document.getElementById("mapForm");
  const mapView = document.getElementById("mapView");
  const mapShape = document.getElementById("mapShape");
  const mapTitle = document.getElementById("mapTitle");
  const mapSubtitle = document.getElementById("mapSubtitle");
  const mapLegend = document.getElementById("mapLegend");
  const mapError = document.getElementById("mapError");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SHAPE_NAMES = { circle: "Circle", cube: "Cube", pyramid: "Pyramid" };

  let siteType = "scatter";
  let siteSettings = {};
  let nodes = [];
  let categories = [];
  let editingId = null;
  let pendingImageDataUrl = null; // set when a new file is chosen
  let imageRemoved = false; // set when "remove image" is clicked while editing

  function siteFileUrl(relPath) {
    return "/site-files/" + relPath.split("/").map(encodeURIComponent).join("/");
  }

  const isTimeline = () => siteType === "timeline";
  const dateScheme = () => (siteSettings.dateScheme || "year");

  // stored dates may be coarser/finer than the current scheme; pad or trim
  function toInputValue(date, scheme) {
    const [y, m = "01", d = "01"] = String(date || "").split("-");
    if (!y) return "";
    if (scheme === "year") return y;
    if (scheme === "month") return `${y}-${m}`;
    return `${y}-${m}-${d}`;
  }

  function formatDate(date) {
    const [y, m, d] = String(date || "").split("-");
    const scheme = dateScheme();
    if (scheme === "year" || !m) return y;
    if (scheme === "month" || !d) return `${MONTHS[+m - 1]} ${y}`;
    return `${MONTHS[+m - 1]} ${+d}, ${y}`;
  }

  function configureDateInput() {
    const scheme = dateScheme();
    const keep = fieldDate.value ? toInputValue(fieldDate.value, scheme) : "";
    if (scheme === "year") {
      fieldDate.type = "number";
      fieldDate.min = 1;
      fieldDate.max = 9999;
      fieldDate.step = 1;
      fieldDate.placeholder = "2019";
      dateHint.textContent = "(year)";
    } else if (scheme === "month") {
      fieldDate.type = "month";
      dateHint.textContent = "(month & year)";
    } else {
      fieldDate.type = "date";
      dateHint.textContent = "(full date)";
    }
    fieldDate.value = keep;
  }

  function clamp(v) {
    return Math.max(-1, Math.min(1, v));
  }

  function toPercent(v) {
    return ((v + 1) / 2) * 100;
  }

  function fromPercent(pct) {
    return clamp((pct / 100) * 2 - 1);
  }

  function setTarget(x, y) {
    fieldX.value = x.toFixed(2);
    fieldY.value = y.toFixed(2);
    miniChartTarget.hidden = false;
    miniChartTarget.style.left = toPercent(x) + "%";
    miniChartTarget.style.top = toPercent(-y) + "%";
  }

  function syncTargetFromFields() {
    const x = clamp(parseFloat(fieldX.value) || 0);
    const y = clamp(parseFloat(fieldY.value) || 0);
    setTarget(x, y);
  }

  miniChart.addEventListener("click", (e) => {
    const rect = miniChart.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const x = fromPercent(relX * 100);
    const y = -fromPercent(relY * 100);
    setTarget(x, y);
  });

  fieldX.addEventListener("input", syncTargetFromFields);
  fieldY.addEventListener("input", syncTargetFromFields);

  function renderExistingDots() {
    miniChartExisting.innerHTML = "";
    if (isTimeline()) return;
    nodes.forEach((node) => {
      if (editingId && node.id === editingId) return; // don't show the node being edited
      const span = document.createElement("span");
      span.style.left = toPercent(node.x) + "%";
      span.style.top = toPercent(-node.y) + "%";
      span.title = node.title;
      miniChartExisting.appendChild(span);
    });
  }

  function quadrantLabel(node) {
    const xLabel = node.x >= 0 ? "Reverent" : "Irreverent";
    const yLabel = node.y >= 0 ? "High Fidelity" : "Low Fidelity";
    return `${xLabel} / ${yLabel}`;
  }

  function categoryById(id) {
    return categories.find((c) => c.id === id);
  }

  function renderList() {
    nodeCount.textContent = nodes.length ? `(${nodes.length})` : "";
    nodeList.innerHTML = "";

    if (!nodes.length) {
      const empty = document.createElement("li");
      empty.className = "node-list__empty";
      empty.textContent = "No nodes yet — add one using the form.";
      nodeList.appendChild(empty);
      return;
    }

    const shown = isTimeline() ? nodes.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) : nodes;
    shown.forEach((node) => {
      const li = document.createElement("li");
      li.className = "node-row";

      const thumb = document.createElement("div");
      thumb.className = "node-row__thumb";
      if (node.image) {
        thumb.style.backgroundImage = `url("${siteFileUrl(node.image)}")`;
      } else {
        thumb.textContent = "No img";
      }

      const body = document.createElement("div");
      body.className = "node-row__body";
      const title = document.createElement("p");
      title.className = "node-row__title";
      title.textContent = node.title;
      const meta = document.createElement("p");
      meta.className = "node-row__meta";

      const cat = categoryById(node.category);
      if (cat) {
        const catSpan = document.createElement("span");
        catSpan.className = "node-row__category";
        const dot = document.createElement("span");
        dot.className = "node-row__category-dot";
        dot.style.background = cat.color;
        catSpan.appendChild(dot);
        catSpan.appendChild(document.createTextNode(cat.name));
        meta.appendChild(catSpan);
      }
      meta.appendChild(
        document.createTextNode(
          isTimeline()
            ? `${formatDate(node.date)} · ${SHAPE_NAMES[node.shape] || "Default shape"}`
            : siteSettings.view === "3d"
            ? `${quadrantLabel(node)} · x ${node.x.toFixed(2)}, y ${node.y.toFixed(2)}`
            : `${quadrantLabel(node)} · x ${node.x.toFixed(2)}, y ${node.y.toFixed(2)}`
        )
      );

      body.appendChild(title);
      body.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "node-row__actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => startEdit(node));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteNode(node));
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(thumb);
      li.appendChild(body);
      li.appendChild(actions);
      nodeList.appendChild(li);
    });
  }

  function renderCategorySelect() {
    const current = fieldCategory.value;
    fieldCategory.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "No category";
    fieldCategory.appendChild(noneOpt);
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      fieldCategory.appendChild(opt);
    });
    if (categories.some((c) => c.id === current)) {
      fieldCategory.value = current;
    }
  }

  function renderCategoryList() {
    categoryCount.textContent = categories.length ? `(${categories.length})` : "";
    categoryList.innerHTML = "";

    if (!categories.length) {
      const empty = document.createElement("li");
      empty.className = "category-list__empty";
      empty.textContent = "No categories yet — add one below.";
      categoryList.appendChild(empty);
      return;
    }

    categories.forEach((cat) => {
      const li = document.createElement("li");
      li.className = "category-row";

      const swatch = document.createElement("span");
      swatch.className = "category-row__swatch";
      swatch.style.background = cat.color;

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "category-row__color";
      colorInput.value = cat.color;
      colorInput.setAttribute("aria-label", `${cat.name} color`);
      colorInput.addEventListener("change", () => updateCategory(cat.id, { color: colorInput.value }));

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "category-row__name";
      nameInput.value = cat.name;
      nameInput.maxLength = 24;
      nameInput.addEventListener("change", () => {
        const value = nameInput.value.trim();
        if (!value || value === cat.name) {
          nameInput.value = cat.name;
          return;
        }
        updateCategory(cat.id, { name: value });
      });

      const count = nodes.filter((n) => n.category === cat.id).length;
      const countSpan = document.createElement("span");
      countSpan.className = "category-row__count";
      countSpan.textContent = count === 1 ? "1 node" : `${count} nodes`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "category-row__delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteCategory(cat));

      li.appendChild(swatch);
      li.appendChild(colorInput);
      li.appendChild(nameInput);
      li.appendChild(countSpan);
      li.appendChild(deleteBtn);
      categoryList.appendChild(li);
    });
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  function showCategoryError(msg) {
    categoryError.textContent = msg;
    categoryError.hidden = !msg;
  }

  const undoBtn = document.getElementById("undoBtn");

  async function refreshUndo() {
    try {
      const res = await fetch("/api/history");
      const body = await res.json();
      undoBtn.disabled = !(body.count > 0);
      undoBtn.textContent = body.count > 0 ? `\u21B6 Undo (${body.count})` : "\u21B6 Undo";
    } catch (err) {
      undoBtn.disabled = true;
    }
  }

  async function undoLast() {
    if (undoBtn.disabled) return;
    undoBtn.disabled = true;
    try {
      const res = await fetch("/api/undo", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Undo failed");
      }
      resetForm();
      await Promise.all([loadCategories(), loadNodes()]);
    } catch (err) {
      showError(err.message || "Couldn't undo.");
      console.error(err);
    }
    refreshUndo();
  }

  undoBtn.addEventListener("click", undoLast);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // keep native text undo
    e.preventDefault();
    undoLast();
  });

  async function loadNodes() {
    try {
      const res = await fetch("/api/nodes");
      nodes = await res.json();
      renderExistingDots();
      renderList();
      renderCategoryList(); // node counts per category can change
      refreshUndo();
    } catch (err) {
      showError("Couldn't load nodes. Is server.py running?");
      console.error(err);
    }
  }

  async function loadCategories() {
    try {
      const res = await fetch("/api/categories");
      categories = await res.json();
      renderCategorySelect();
      renderCategoryList();
      refreshUndo();
    } catch (err) {
      showCategoryError("Couldn't load categories.");
      console.error(err);
    }
  }

  async function updateCategory(id, changes) {
    showCategoryError("");
    try {
      const existing = categoryById(id) || {};
      const payload = { name: existing.name, color: existing.color, ...changes };
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Update failed");
      await loadCategories();
      await loadNodes(); // colors/names shown in the node list may have changed
    } catch (err) {
      showCategoryError("Couldn't update that category.");
      console.error(err);
    }
  }

  async function deleteCategory(cat) {
    const count = nodes.filter((n) => n.category === cat.id).length;
    const warning = count
      ? `Delete "${cat.name}"? ${count} node${count === 1 ? "" : "s"} using it will lose this color.`
      : `Delete "${cat.name}"?`;
    if (!confirm(warning)) return;
    showCategoryError("");
    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await loadCategories();
      await loadNodes();
    } catch (err) {
      showCategoryError("Couldn't delete that category.");
      console.error(err);
    }
  }

  categoryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showCategoryError("");
    const name = categoryName.value.trim();
    if (!name) {
      showCategoryError("Category name is required.");
      return;
    }
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: categoryColor.value })
      });
      if (!res.ok) throw new Error("Create failed");
      categoryForm.reset();
      categoryColor.value = "#7dd3fc";
      await loadCategories();
    } catch (err) {
      showCategoryError("Couldn't create that category.");
      console.error(err);
    }
  });

  function resetForm() {
    editingId = null;
    pendingImageDataUrl = null;
    imageRemoved = false;
    form.reset();
    fieldX.value = 0;
    fieldY.value = 0;
    fieldCategory.value = "";
    setTarget(0, 0);
    fieldDate.value = "";
    fieldShape.value = "";
    imagePreviewWrap.hidden = true;
    imagePreview.src = "";
    formTitle.textContent = "Add a node";
    submitBtn.textContent = "Add node";
    cancelEditBtn.hidden = true;
    showError("");
    renderExistingDots();
  }

  function startEdit(node) {
    editingId = node.id;
    pendingImageDataUrl = null;
    imageRemoved = false;

    fieldTitle.value = node.title;
    fieldCategory.value = categoryById(node.category) ? node.category : "";
    fieldDescription.value = node.description || "";
    fieldTags.value = (node.tags || []).join(", ");
    fieldLink.value = node.link || "";
    fieldImage.value = "";
    fieldShape.value = node.shape || "";
    if (isTimeline()) {
      fieldDate.value = toInputValue(node.date, dateScheme());
    } else {
      setTarget(node.x, node.y);
    }

    if (node.image) {
      imagePreview.src = siteFileUrl(node.image);
      imagePreviewWrap.hidden = false;
    } else {
      imagePreviewWrap.hidden = true;
    }

    formTitle.textContent = `Editing "${node.title}"`;
    submitBtn.textContent = "Save changes";
    cancelEditBtn.hidden = false;
    showError("");
    renderExistingDots();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteNode(node) {
    if (!confirm(`Delete "${node.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/nodes/${encodeURIComponent(node.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      if (editingId === node.id) resetForm();
      await loadNodes();
    } catch (err) {
      showError("Couldn't delete that node.");
      console.error(err);
    }
  }

  fieldImage.addEventListener("change", () => {
    const file = fieldImage.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingImageDataUrl = reader.result;
      imageRemoved = false;
      imagePreview.src = pendingImageDataUrl;
      imagePreviewWrap.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  imagePreviewRemove.addEventListener("click", () => {
    pendingImageDataUrl = null;
    imageRemoved = true;
    fieldImage.value = "";
    imagePreview.src = "";
    imagePreviewWrap.hidden = true;
  });

  cancelEditBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");

    const title = fieldTitle.value.trim();
    if (!title) {
      showError("Title is required.");
      return;
    }

    const payload = {
      title,
      category: fieldCategory.value,
      description: fieldDescription.value.trim(),
      tags: fieldTags.value,
      link: fieldLink.value.trim()
    };
    if (isTimeline()) {
      if (!fieldDate.value) {
        showError("Date is required.");
        return;
      }
      payload.date = fieldDate.value;
      payload.shape = fieldShape.value;
    } else {
      payload.shape = fieldShape.value;
      payload.x = clamp(parseFloat(fieldX.value) || 0);
      payload.y = clamp(parseFloat(fieldY.value) || 0);
    }

    if (pendingImageDataUrl) payload.imageDataUrl = pendingImageDataUrl;
    if (imageRemoved) payload.removeImage = true;

    submitBtn.disabled = true;
    try {
      const url = editingId ? `/api/nodes/${encodeURIComponent(editingId)}` : "/api/nodes";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }
      resetForm();
      await loadNodes();
    } catch (err) {
      showError(err.message || "Something went wrong saving that node.");
      console.error(err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- site type / timeline settings ----------

  async function loadSite() {
    try {
      const res = await fetch("/api/site");
      const body = await res.json();
      siteType = body.type === "timeline" ? "timeline" : "scatter";
      siteSettings = body.settings || {};
    } catch (err) {
      console.error(err);
      siteType = "scatter";
      siteSettings = {};
    }
    document.body.dataset.siteType = siteType;
    document.body.dataset.view = !isTimeline() && siteSettings.view === "3d" ? "3d" : "flat";
    if (isTimeline()) {
      siteTitle.value = siteSettings.title || "";
      siteSubtitle.value = siteSettings.subtitle || "";
      siteScheme.value = dateScheme();
      siteShape.value = siteSettings.nodeShape || "circle";
      configureDateInput();
    } else {
      mapView.value = siteSettings.view || "flat";
      mapShape.value = siteSettings.nodeShape || "circle";
      mapTitle.value = siteSettings.title || "";
      mapSubtitle.value = siteSettings.subtitle || "";
      mapLegend.checked = siteSettings.showLegend !== false;
    }
    fieldShape.options[0].textContent = `Site default (${SHAPE_NAMES[(isTimeline() ? siteSettings.nodeShape : siteSettings.nodeShape) || "circle"]})`;
    resetForm();
  }

  siteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    siteError.hidden = true;
    try {
      const res = await fetch("/api/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: siteTitle.value,
          subtitle: siteSubtitle.value,
          dateScheme: siteScheme.value,
          nodeShape: siteShape.value
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed");
      await loadSite();
      renderList();
    } catch (err) {
      siteError.textContent = err.message || "Couldn't save the settings.";
      siteError.hidden = false;
    }
  });

  mapForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    mapError.hidden = true;
    try {
      const res = await fetch("/api/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: mapView.value,
          nodeShape: mapShape.value,
          title: mapTitle.value,
          subtitle: mapSubtitle.value,
          showLegend: mapLegend.checked
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed");
      await loadSite();
    } catch (err) {
      mapError.textContent = err.message || "Couldn't save the settings.";
      mapError.hidden = false;
    }
  });

  // ---------- site folder targeting ----------

  function showFolderError(msg) {
    folderErrorEl.textContent = msg;
    folderErrorEl.hidden = !msg;
  }

  function showSetupError(msg) {
    setupError.textContent = msg;
    setupError.hidden = !msg;
  }

  function renderRecentChips(container, recents, currentPath, onPick) {
    container.innerHTML = "";
    const others = recents.filter((r) => r !== currentPath);
    if (!others.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const label = document.createElement("span");
    label.className = "folder-recent__label";
    label.textContent = "Recent:";
    container.appendChild(label);
    others.forEach((path) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "folder-recent__chip";
      chip.textContent = path;
      chip.title = path;
      chip.addEventListener("click", () => onPick(path));
      container.appendChild(chip);
    });
  }

  function showSetup(recents) {
    setupCard.hidden = false;
    editorLayout.hidden = true;
    folderPath.textContent = "Not set";
    folderRecent.hidden = true;
    renderRecentChips(setupRecent, recents || [], null, (path) => {
      setupFolderInput.value = path;
      applyFolder(path, showSetupError);
    });
  }

  function showEditor(path, recents) {
    setupCard.hidden = true;
    editorLayout.hidden = false;
    folderPath.textContent = path;
    folderPath.title = path;
    renderRecentChips(folderRecent, recents || [], path, (pick) => {
      applyFolder(pick, showFolderError);
    });
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      return await res.json();
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async function applyFolder(path, onError) {
    if (!path) {
      onError("Enter a folder path.");
      return false;
    }
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetFolder: path,
          siteType: (document.querySelector('input[name="siteType"]:checked') || {}).value
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error || "Couldn't use that folder.");
        return false;
      }
      folderEditForm.hidden = true;
      showEditor(body.targetFolder, body.recentFolders);
      await loadSite();
      await Promise.all([loadCategories(), loadNodes()]);
      return true;
    } catch (err) {
      console.error(err);
      onError("Couldn't reach the editor server.");
      return false;
    }
  }

  folderChangeBtn.addEventListener("click", () => {
    folderInput.value = folderPath.textContent === "Not set" ? "" : folderPath.textContent;
    showFolderError("");
    folderEditForm.hidden = false;
    folderInput.focus();
  });

  folderCancelBtn.addEventListener("click", () => {
    folderEditForm.hidden = true;
    showFolderError("");
  });

  folderEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showFolderError("");
    const ok = await applyFolder(folderInput.value.trim(), showFolderError);
    if (ok) folderEditForm.hidden = true;
  });

  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showSetupError("");
    await applyFolder(setupFolderInput.value.trim(), showSetupError);
  });

  async function init() {
    setTarget(0, 0);
    const config = await loadConfig();
    if (config && config.targetFolder) {
      showEditor(config.targetFolder, config.recentFolders);
      await loadSite();
      await Promise.all([loadCategories(), loadNodes()]);
    } else {
      showSetup(config ? config.recentFolders : []);
    }
  }

  init();
})();
