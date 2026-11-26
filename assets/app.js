/* HockeyManager mods — frontend logic
 * - Loads manifest.json
 * - For repo zips: fetches the archive, extracts mod.json with JSZip, shows metadata
 * - For Google Drive links: uses metadata provided in the manifest
 * All fetches resolve relative to the site root and work on GitHub Pages
 * project subpaths, custom domains and local previews alike.
 */
(function () {
  "use strict";

  const grid = document.getElementById("mods");
  const searchInput = document.getElementById("search");
  const heroTitle = document.getElementById("heroTitle");
  const heroSub = document.getElementById("heroSubtitle");
  const statCount = document.getElementById("statCount");

  let ALL_MODS = [];

  // ---------- URL resolution (host-agnostic) ----------
  // Builds a list of candidate absolute URLs for a repo-relative path so the
  // site works whether it is served from "/" (user/org pages, local preview,
  // Netlify root) or from a subpath like "/HockeyManager_mods/" (GitHub Pages
  // project sites) and even when the page URL is missing its trailing slash.
  function candidateUrls(rel) {
    const out = [];
    const base = document.baseURI.endsWith("/") ? document.baseURI : document.baseURI + "/";
    out.push(new URL(rel, base).href);

    // GitHub Pages project site: first path segment is the repository name.
    if (/github\.io$/.test(location.hostname)) {
      const seg = location.pathname.split("/").filter(Boolean)[0];
      if (seg) out.push(location.origin + "/" + seg + "/" + rel.replace(/^\/+/, ""));
    }
    out.push(location.origin + "/" + rel.replace(/^\/+/, ""));
    return Array.from(new Set(out));
  }

  async function fetchFirst(urls) {
    let lastErr;
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: "no-cache" });
        if (r.ok) return r;
        lastErr = new Error("HTTP " + r.status);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("fetch failed");
  }

  // ---------- Drive link helpers ----------
  function driveId(url) {
    if (!url) return null;
    let m = url.match(/[?&]id=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = url.match(/\/file\/d\/([^/?#]+)/);
    if (m) return m[1];
    m = url.match(/\/d\/([^/?#]+)/);
    if (m) return m[1];
    return null;
  }
  function driveDownload(url) {
    const id = driveId(url);
    if (!id) return url; // already a direct link or unknown — pass through
    return "https://drive.google.com/uc?export=download&id=" + id;
  }

  // ---------- Zip helpers ----------
  function findModJson(zip) {
    let target = null;
    zip.forEach(function (path, file) {
      if (!target && /(^|\/)mod\.json$/i.test(path) && !file.dir) target = path;
    });
    return target;
  }

  async function readRepoMod(entry) {
    const res = await fetchFirst(candidateUrls(entry.file));
    const size = res.headers.get("content-length");
    const buf = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const path = findModJson(zip);
    if (!path) throw new Error("В архиве нет mod.json");
    const text = await zip.file(path).async("string");
    const data = JSON.parse(text);
    return Object.assign(
      {
        name: entry.file.split("/").pop().replace(/\.zip$/i, ""),
        description: "",
        author: null,
        version: "",
      },
      data,
      { _download: candidateUrls(entry.file)[0], _size: size, _source: "repo" }
    );
  }

  function readDriveMod(entry) {
    return Object.assign(
      {
        name: "Мод с Google Диска",
        description: "",
        author: null,
        version: "",
      },
      entry,
      { _download: driveDownload(entry.url), _source: "drive" }
    );
  }

  async function loadMod(entry) {
    try {
      if (entry.source === "drive") return readDriveMod(entry);
      return await readRepoMod(entry);
    } catch (e) {
      return Object.assign({}, entry, {
        name: entry.name || (entry.file || "Мод").split("/").pop(),
        description: "Не удалось загрузить мод: " + e.message,
        _error: true,
        _download: entry.source === "drive" ? driveDownload(entry.url) : candidateUrls(entry.file || "")[0],
        _source: entry.source || "repo",
      });
    }
  }

  // ---------- Rendering ----------
  function fmtSize(bytes) {
    if (!bytes) return "";
    const n = Number(bytes);
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function card(m) {
    const siz = m._size ? `<span class="sz">${fmtSize(m._size)}</span>` : "";
    const ver = m.version ? `<span class="ver">v${esc(m.version)}</span>` : "";
    const srcLabel = m._source === "drive" ? "Google Диск" : "репозиторий";
    const author = m.author
      ? `<span class="author">${esc(m.author)}</span><span class="dot">•</span><span>${srcLabel}</span>`
      : `<span>${srcLabel}</span>`;
    const cls = "card" + (m._error ? " err" : "");
    const btn = m._error ? "Открыть ссылку" : "⬇ Скачать ZIP";
    return `
      <article class="${cls}">
        <div class="card-top">
          <div class="card-icon">🏒</div>${ver}
        </div>
        <h3>${esc(m.name)}</h3>
        <p class="desc">${esc(m.description)}</p>
        <div class="meta">${author}</div>
        <a class="download" href="${esc(m._download)}" download>${btn}${siz}</a>
      </article>`;
  }

  function render(list) {
    if (!list.length) {
      grid.innerHTML = '<div class="loading">Ничего не найдено.</div>';
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  function applyFilter(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return render(ALL_MODS);
    const f = ALL_MODS.filter(function (m) {
      return [m.name, m.description, m.author]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    render(f);
  }

  // ---------- Game download section ----------
  function gameIcon(url, file) {
    const s = (url || file || "").toLowerCase();
    if (s.indexOf("apk") !== -1) return "🤖";
    if (s.indexOf("portable") !== -1) return "💾";
    if (s.indexOf(".exe") !== -1 || s.indexOf("setup") !== -1) return "🪟";
    return "⬇";
  }

  function renderGame(game) {
    const section = document.getElementById("game");
    const wrap = document.getElementById("gameLinks");
    const titleEl = document.getElementById("gameTitle");
    if (!section || !wrap) return;
    if (!game || !Array.isArray(game.links) || !game.links.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    if (game.title && titleEl) titleEl.textContent = game.title;
    wrap.innerHTML = game.links
      .map(function (l) {
        const label = l.label || l.file || "Скачать";
        const fn = l.file || "";
        return `<a class="game-btn" href="${esc(l.url)}" download>
          <span class="game-ico">${gameIcon(l.url, l.file)}</span>
          <span class="game-txt"><b>${esc(label)}</b>${fn ? `<small>${esc(fn)}</small>` : ""}</span>
          <span class="game-arrow" aria-hidden="true">↓</span>
        </a>`;
      })
      .join("");
  }

  // ---------- Modal ----------
  function setupModal() {
    const modal = document.getElementById("howModal");
    const open = document.getElementById("howBtn");
    const close = document.getElementById("howClose");
    if (!modal) return;
    const show = function (e) { e && e.preventDefault(); modal.hidden = false; };
    const hide = function () { modal.hidden = true; };
    open && open.addEventListener("click", show);
    close && close.addEventListener("click", hide);
    modal.addEventListener("click", function (e) { if (e.target === modal) hide(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
  }

  // ---------- Init ----------
  async function init() {
    setupModal();
    let manifest;
    try {
      const res = await fetchFirst(candidateUrls("manifest.json"));
      manifest = await res.json();
    } catch (e) {
      grid.innerHTML = '<div class="loading">Не удалось загрузить manifest.json: ' + esc(e.message) + ". Проверьте, что файл есть в опубликованной ветке.</div>";
      return;
    }

    if (manifest.title) heroTitle.textContent = manifest.title;
    if (manifest.subtitle) heroSub.textContent = manifest.subtitle;
    document.title = manifest.title || "HockeyManager — Моды";

    renderGame(manifest.game);

    const entries = Array.isArray(manifest.mods) ? manifest.mods : [];
    const mods = await Promise.all(entries.map(loadMod));
    ALL_MODS = mods;
    statCount.textContent = mods.length;
    render(ALL_MODS);

    searchInput && searchInput.addEventListener("input", function (e) { applyFilter(e.target.value); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
