// ---------------------------------------------------------------------
// Lo-fi effects a skin can turn on (skin field "lofi"): a chunky, pixelated
// render and ordered (Bayer) dithering of images. Text is never pixelated —
// it always stays readable. Shared by the flat and 3D pages; a plain script
// with no dependencies that sets window.LoFi.
//
//   lofi.pixelate      1 = off, otherwise the size of a "pixel" in CSS px
//   lofi.crunchHeader  also pixelate the page header (title + subtext); off
//                      by default, since it makes the text hard to read
//   lofi.dither        dither every image
//   lofi.ditherPalette "bw" (black & white) or "skin" (the page's text and
//                      background colors)
//   lofi.ditherSize    size of one dither dot in CSS px
//
// 3D pages: the scene is drawn into a small render target and scaled up with
// hard edges, then any object on layer 1 (the text labels) is drawn on top
// at full resolution. Flat pages: images are shown as chunky pixels.
// ---------------------------------------------------------------------
(function () {
  const DEFAULTS = { pixelate: 1, crunchHeader: false, dither: false, ditherPalette: "bw", ditherSize: 2 };
  const TEXT_LAYER = 1;

  // 8x8 Bayer threshold matrix
  const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];

  const settings = (lofi) => ({ ...DEFAULTS, ...(lofi || {}) });
  const pixelSize = (s) => Math.max(1, Math.round(s.pixelate || 1));

  const probe = document.createElement("canvas").getContext("2d");

  // any CSS color -> [r, g, b], via the canvas color parser
  function toRgb(color, fallback) {
    probe.fillStyle = fallback;
    probe.fillStyle = color || fallback;
    const v = probe.fillStyle;
    if (v[0] === "#") return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    const m = v.match(/(\d+(?:\.\d+)?)/g) || [0, 0, 0];
    return m.slice(0, 3).map(Number);
  }

  // the two inks a dither uses: black & white, or the page's own text on its background
  function inks(s) {
    if (s.ditherPalette === "skin") {
      const cs = getComputedStyle(document.documentElement);
      return { dark: toRgb(cs.getPropertyValue("--text").trim(), "#000"), light: toRgb(cs.getPropertyValue("--bg").trim(), "#fff") };
    }
    return { dark: [0, 0, 0], light: [255, 255, 255] };
  }

  // one dither dot (or, undithered, one pixel) is never smaller than a
  // pixelate cell, or the two patterns fight
  function dotSize(s) {
    return Math.max(1, s.dither ? s.ditherSize : 1, pixelSize(s));
  }

  // does this setting change how images look at all?
  const touchesImages = (s) => s.dither || pixelSize(s) > 1;

  const canvasCache = new Map();

  // a small copy of `img` whose shorter side is `shortSide` pixels —
  // dithered if the skin asks for it. Draw it scaled up with smoothing off.
  function imageCanvas(img, shortSide, lofi) {
    const s = settings(lofi);
    const ink = s.dither ? inks(s) : null;
    const key = `${img.src}|${Math.round(shortSide)}|${s.dither}|${ink ? ink.dark + "/" + ink.light : ""}`;
    if (canvasCache.has(key)) return canvasCache.get(key);
    const scale = Math.max(4, Math.round(shortSide)) / Math.min(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    if (ink) {
      const px = ctx.getImageData(0, 0, w, h);
      const d = px.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
          const out = lum > (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64 ? ink.light : ink.dark;
          d[i] = out[0];
          d[i + 1] = out[1];
          d[i + 2] = out[2];
          d[i + 3] = d[i + 3] < 128 ? 0 : 255;
        }
      }
      ctx.putImageData(px, 0, 0);
    }
    if (canvasCache.size > 200) canvasCache.clear();
    canvasCache.set(key, c);
    return c;
  }

  // for a 3D node: the photo as-is, or a small dithered copy sized so a dot
  // is the right number of CSS px once drawn into a node `displayShort` px across
  function nodeImage(img, displayShort, lofi) {
    const s = settings(lofi);
    if (!img || !s.dither) return img; // pixelate alone is handled by the scene pass
    return imageCanvas(img, displayShort / dotSize(s), s);
  }

  const imagePromises = new Map();
  function loadImage(url) {
    if (!imagePromises.has(url)) {
      imagePromises.set(
        url,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        })
      );
    }
    return imagePromises.get(url);
  }

  // show an image in the page (thumbnail, tooltip, detail panel), processed
  // for the skin. `apply(url)` sets it; `el` gets crisp scaling. Calling it
  // again with the same image and settings does nothing, so it's cheap to
  // call on every hover.
  function showImage(el, url, lofi, displayShort, apply) {
    const s = settings(lofi);
    const ink = s.dither ? inks(s) : null;
    const key = JSON.stringify([url, s, ink, displayShort]);
    if (el.dataset.lofiKey === key) return;
    el.dataset.lofiKey = key;
    el.style.imageRendering = touchesImages(s) ? "pixelated" : "";
    if (!url || !touchesImages(s)) {
      apply(url);
      return;
    }
    loadImage(url)
      .then((img) => imageCanvas(img, displayShort / dotSize(s), s).toDataURL("image/png"))
      .catch(() => url)
      .then((out) => {
        if (el.dataset.lofiKey === key) apply(out);
      });
  }

  // 3D: draws the scene chunky and its text sharp. Mark text objects with
  // LoFi.markText(obj); call pixelator.render(scene, camera, lofi) in place
  // of renderer.render(scene, camera).
  function createScenePixelator(THREE, renderer) {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true
    });
    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMaterial = new THREE.MeshBasicMaterial({
      map: target.texture,
      transparent: true,
      premultipliedAlpha: true, // the target holds blended (premultiplied) colors
      depthTest: false,
      depthWrite: false
    });
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial));
    const size = new THREE.Vector2();

    return {
      render(scene, camera, lofi) {
        const px = pixelSize(settings(lofi));
        camera.layers.enable(0);
        camera.layers.enable(TEXT_LAYER);
        if (px <= 1) {
          renderer.render(scene, camera);
          return;
        }
        renderer.getSize(size);
        const w = Math.max(1, Math.ceil(size.x / px));
        const h = Math.max(1, Math.ceil(size.y / px));
        if (target.width !== w || target.height !== h) target.setSize(w, h);
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;

        // everything but text, at low resolution
        camera.layers.disable(TEXT_LAYER);
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(quadScene, quadCamera);

        // then the text, sharp, on top
        camera.layers.set(TEXT_LAYER);
        renderer.clearDepth();
        const background = scene.background;
        scene.background = null;
        renderer.render(scene, camera);
        scene.background = background;

        camera.layers.enable(0);
        renderer.autoClear = autoClear;
      }
    };
  }

  // dithered photos must be sampled without smoothing or the dots blur to gray
  function crispTexture(THREE, tex, lofi) {
    if (!settings(lofi).dither) return tex;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // the page header, pixelated with an SVG filter when lofi.crunchHeader is
  // on. The filter works in page coordinates, so its sampling grid is
  // anchored to the header's top-left corner and re-anchored on resize.
  const NS = "http://www.w3.org/2000/svg";
  let headerFilter = null;
  let headerEl = null;
  let headerSize = 1;

  function drawHeaderFilter() {
    if (!headerFilter || !headerEl) return;
    const r = headerEl.getBoundingClientRect();
    const ox = Math.round(r.left + window.scrollX);
    const oy = Math.round(r.top + window.scrollY);
    const half = Math.floor(headerSize / 2);
    // blur first so each sample is roughly the cell's average, then keep one
    // pixel per size×size cell and grow it back to fill the cell
    headerFilter.innerHTML =
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${headerSize / 3}" result="avg"/>` +
      `<feFlood x="${ox + half}" y="${oy + half}" width="1" height="1"/>` +
      `<feComposite x="${ox}" y="${oy}" width="${headerSize}" height="${headerSize}"/>` +
      `<feTile result="grid"/>` +
      `<feComposite in="avg" in2="grid" operator="in"/>` +
      `<feMorphology operator="dilate" radius="${half}"/>`;
  }
  window.addEventListener("resize", drawHeaderFilter);

  function applyHeader(lofi) {
    const s = settings(lofi);
    const el = document.querySelector(".header");
    if (!el) return;
    headerSize = s.crunchHeader ? pixelSize(s) : 1;
    if (headerSize <= 1) {
      el.style.filter = "";
      return;
    }
    if (!headerFilter) {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      headerFilter = document.createElementNS(NS, "filter");
      headerFilter.id = "lofi-header";
      for (const [k, v] of [["x", "0"], ["y", "0"], ["width", "100%"], ["height", "100%"]]) headerFilter.setAttribute(k, v);
      svg.appendChild(headerFilter);
      document.body.appendChild(svg);
    }
    headerEl = el;
    drawHeaderFilter();
    el.style.filter = "url(#lofi-header)";
  }

  function markText(obj) {
    obj.layers.set(TEXT_LAYER);
    return obj;
  }

  window.LoFi = {
    defaults: () => ({ ...DEFAULTS }),
    settings,
    nodeImage,
    showImage,
    createScenePixelator,
    markText,
    applyHeader,
    crispTexture,
    smoothing: (lofi) => !settings(lofi).dither // keep dither dots crisp when drawn into a node
  };
})();
