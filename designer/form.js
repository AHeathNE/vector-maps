// ---------------------------------------------------------------------
// Builds the designer's controls from a schema (see schema.js) and keeps
// them in sync with a skin object. Every color field pairs a native swatch
// (quick, visual) with a text field (exact, and the only way to see or type
// a value that isn't a plain #rrggbb), so there's always more than one way
// to pick a color.
// ---------------------------------------------------------------------

import { cssToHex } from "./schema.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// assigns even when the value is undefined (keeping the key): the apps
// merge a skin over their *current* one, so an explicitly-undefined key is
// how "cleared" reaches them, where a deleted key would silently keep the
// old value
export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let target = obj;
  for (const key of keys) {
    if (target[key] == null || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  }
  target[last] = value;
}

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...kids);
  return node;
}

export function createForm({ container, schema, caps, getSkin, onChange }) {
  container.replaceChildren();
  const has = (cap) => !cap || caps.includes(cap);
  const entries = [];

  const commit = (field, value) => {
    const skin = getSkin();
    setPath(skin, field.path, value);
    if (field.onSet) field.onSet(skin, value, caps);
    refresh();
    onChange(field.path);
  };

  // ---- one builder per field type; each returns { el, sync(value) } ----

  function colorField(f) {
    const picker = h("input", { type: "color", "aria-label": f.label });
    const text = h("input", { type: "text", spellcheck: "false", "aria-label": `${f.label} (hex)` });
    picker.addEventListener("input", () => {
      text.value = picker.value;
      commit(f, picker.value);
    });
    text.addEventListener("input", () => {
      if (HEX.test(text.value)) picker.value = text.value;
      commit(f, text.value);
    });
    return {
      el: h("div", { className: "designer__row" }, h("label", { text: f.label }), h("div", { className: "designer__color-pair" }, picker, text)),
      sync(value) {
        if (document.activeElement !== text) text.value = value ?? "";
        if (document.activeElement !== picker) picker.value = cssToHex(value);
      }
    };
  }

  // for values that are a full CSS color (rgba with transparency, etc.):
  // the text field is the source of truth, the swatch is a quick solid pick
  function cssColorField(f) {
    const text = h("input", { type: "text", spellcheck: "false", placeholder: f.placeholder || "", "aria-label": f.label });
    const picker = h("input", {
      type: "color",
      title: "Pick a solid color (replaces the current value, including any transparency)",
      "aria-label": `${f.label} (swatch)`
    });
    const value = (raw) => (f.optional && raw === "" ? undefined : raw);
    text.addEventListener("input", () => commit(f, value(text.value)));
    picker.addEventListener("input", () => {
      text.value = picker.value;
      commit(f, picker.value);
    });
    return {
      el: h("div", { className: "designer__row--stack" }, h("label", { text: f.label }), h("div", { className: "designer__color-pair" }, text, picker)),
      sync(v) {
        if (document.activeElement !== text) text.value = v ?? "";
        if (document.activeElement !== picker) picker.value = cssToHex(v);
      }
    };
  }

  function textField(f) {
    const text = h("input", { type: "text", spellcheck: "false", placeholder: f.placeholder || "", "aria-label": f.label });
    text.addEventListener("input", () => commit(f, text.value));
    return {
      el: h("div", { className: "designer__row--stack" }, h("label", { text: f.label }), text),
      sync(v) {
        if (document.activeElement !== text) text.value = v ?? "";
      }
    };
  }

  function selectField(f) {
    const options = f.options.filter((o) => has(o.requires));
    const select = h("select", { "aria-label": f.label }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
    select.addEventListener("change", () => commit(f, select.value));
    return {
      options,
      el: h("div", { className: "designer__row" }, h("label", { text: f.label }), select),
      // a value this app can't do just shows the app's own first choice,
      // without touching the skin (so saving it elsewhere loses nothing)
      sync(v) {
        select.value = options.some((o) => o.value === v) ? v : options[0].value;
      }
    };
  }

  function rangeField(f) {
    const readout = h("span", { className: "designer__readout" });
    const input = h("input", { type: "range", min: f.min, max: f.max, step: f.step, "aria-label": f.label });
    input.addEventListener("input", () => commit(f, Number(input.value)));
    return {
      el: h("div", { className: "designer__row" }, h("label", {}, `${f.label} — `, readout), input),
      sync(v) {
        input.value = v;
        readout.textContent = v;
      }
    };
  }

  function checkboxField(f) {
    const input = h("input", { type: "checkbox" });
    input.addEventListener("change", () => commit(f, input.checked));
    return {
      el: h("div", { className: "designer__row" }, h("label", {}, input, ` ${f.label}`)),
      sync(v) {
        input.checked = !!v;
      }
    };
  }

  function paletteField(f) {
    const list = h("div", { className: "designer__palette-list" });
    const add = h("button", { type: "button", className: "designer__btn designer__btn--small", text: "+ Add color" });
    let rendered = "";

    const palette = () => {
      const skin = getSkin();
      if (!Array.isArray(getPath(skin, f.path))) setPath(skin, f.path, []);
      return getPath(skin, f.path);
    };

    const render = () => {
      list.replaceChildren();
      palette().forEach((color, i) => {
        const picker = h("input", { type: "color", "aria-label": `Palette color ${i + 1}` });
        const text = h("input", { type: "text", spellcheck: "false", "aria-label": `Palette color ${i + 1} (hex)` });
        picker.value = cssToHex(color);
        text.value = color;
        picker.addEventListener("input", () => {
          text.value = picker.value;
          palette()[i] = picker.value;
          rendered = JSON.stringify(palette());
          onChange(f.path);
        });
        text.addEventListener("input", () => {
          palette()[i] = text.value;
          if (HEX.test(text.value)) picker.value = text.value;
          rendered = JSON.stringify(palette());
          onChange(f.path);
        });
        const remove = h("button", { type: "button", title: "Remove color", text: "×" });
        remove.addEventListener("click", () => {
          palette().splice(i, 1);
          render();
          onChange(f.path);
        });
        list.append(h("div", { className: "designer__swatch" }, picker, text, remove));
      });
      rendered = JSON.stringify(palette());
    };

    add.addEventListener("click", () => {
      palette().push("#888888");
      render();
      onChange(f.path);
    });

    return {
      el: h("div", { className: "designer__row--stack" }, h("label", { className: "designer__label", text: f.label }), list, add),
      sync() {
        // rebuild only when the palette changed from outside (a different
        // skin was loaded) and the user isn't mid-edit in it
        if (JSON.stringify(palette()) !== rendered && !list.contains(document.activeElement)) render();
      }
    };
  }

  const builders = {
    color: colorField,
    cssColor: cssColorField,
    text: textField,
    select: selectField,
    range: rangeField,
    checkbox: checkboxField,
    palette: paletteField
  };

  for (const section of schema.sections) {
    if (!has(section.requires)) continue;
    const sectionEl = h("section", { className: "designer__section" }, h("h2", { className: "designer__subheading", text: section.title }));
    if (section.note) sectionEl.append(h("p", { className: "designer__hint", text: section.note }));
    for (const field of section.fields) {
      if (!has(field.requires)) continue;
      const builder = builders[field.type](field);
      sectionEl.append(builder.el);
      entries.push({ field, builder });
    }
    container.append(sectionEl);
  }

  // conditions look at the skin as this app sees it: a select holding a
  // value the app can't do counts as its fallback, so a hidden/shown row
  // always matches what the control displays
  function effectiveView(skin) {
    const view = structuredClone(skin);
    for (const { field, builder } of entries) {
      if (!builder.options) continue;
      if (!builder.options.some((o) => o.value === getPath(view, field.path))) setPath(view, field.path, builder.options[0].value);
    }
    return view;
  }

  function refresh() {
    const skin = getSkin();
    const view = effectiveView(skin);
    for (const { field, builder } of entries) {
      builder.sync(getPath(skin, field.path));
      builder.el.hidden = field.when ? !field.when(view, caps) : false;
    }
  }

  return { refresh };
}
