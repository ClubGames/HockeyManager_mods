/* HockeyManager mods — frontend logic
 * - Loads manifest.json
 * - For repo zips: fetches the archive, reads mod.json + optional roster.json /
 *   schedule.json / club logos with JSZip right in the browser
 * - For Google Drive links: uses metadata provided in the manifest
 * Works identically on GitHub Pages project subpaths, custom domains and local previews.
 */
(function () {
  "use strict";

  const listEl = document.getElementById("mods");
  const searchInput = document.getElementById("search");
  const searchClear = document.getElementById("searchClear");
  const heroTitle = document.getElementById("heroTitle");
  const heroSub = document.getElementById("heroSubtitle");
  const statCount = document.getElementById("statCount");

  let ALL_MODS = [];

  // ---------- Helpers ----------
  function pluralRu(n, one, two, five) {
    const abs = Math.abs(n) % 100;
    const n1 = abs % 10;
    if (abs > 10 && abs < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
  }

  function fmtSize(bytes) {
    const n = Number(bytes);
    if (!n || n <= 0) return "";
    if (n < 1024) return n + " Б";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " КБ";
    return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ";
  }

  function fmtRub(amount) {
    const n = Number(amount);
    if (!n || n <= 0) return "";
    if (n >= 1e9) {
      const v = (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2).replace(/\.?0+$/, "").replace(".", ",");
      return v + " млрд ₽";
    }
    if (n >= 1e6) return Math.round(n / 1e6) + " млн ₽";
    return n.toLocaleString("ru-RU") + " ₽";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "ХК";
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function sortConferences(names) {
    const order = { "Запад": 1, "West": 1, "Восток": 2, "East": 2 };
    return names.slice().sort(function (a, b) {
      const oa = order[a] || 99;
      const ob = order[b] || 99;
      if (oa !== ob) return oa - ob;
      return String(a).localeCompare(String(b), "ru");
    });
  }

  // ---------- Clean Monochrome Icons ----------
  const ICONS = {
    download:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5V10.5M8 10.5L4.8 7.3M8 10.5L11.2 7.3M3 13H13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowDown:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3V12.2M8 12.2L4.6 8.8M8 12.2L11.4 8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    windows:
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.8 4.6L9.1 3.7V9.4H2.8V4.6ZM10.2 3.55L17.2 2.5V9.4H10.2V3.55ZM2.8 10.5H9.1V16.25L2.8 15.35V10.5ZM10.2 10.5H17.2V17.5L10.2 16.45V10.5Z" fill="currentColor"/></svg>',
    portable:
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="13" height="10.5" rx="1.8" stroke="currentColor" stroke-width="1.6"/><path d="M6.8 6V3.6H13.2V6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11.2H12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    android:
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.2 13.5C4.2 10.1 6.8 7.4 10 7.4C13.2 7.4 15.8 10.1 15.8 13.5V14.8H4.2V13.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.8 7.8L5.1 5.1M13.2 7.8L14.9 5.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7.8" cy="11.3" r="0.9" fill="currentColor"/><circle cx="12.2" cy="11.3" r="0.9" fill="currentColor"/></svg>',
    file:
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 3.5H11.5L15 7V16.5H5V3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.2 3.5V7.2H15" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };

  // ---------- URL resolution (host-agnostic) ----------
  function candidateUrls(rel) {
    const out = [];
    const base = document.baseURI.endsWith("/") ? document.baseURI : document.baseURI + "/";
    out.push(new URL(rel, base).href);

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
    if (!id) return url;
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

  function resolveZipFile(zip, baseDir, relPath) {
    if (!relPath) return null;
    const clean = String(relPath).replace(/^\.?\//, "");
    const direct = zip.file(baseDir + clean) || zip.file(clean);
    if (direct && !direct.dir) return direct;

    const lowerTarget = (baseDir + clean).toLowerCase();
    const lowerFallback = clean.toLowerCase();
    let matched = null;
    zip.forEach(function (p, f) {
      if (matched || f.dir) return;
      const lp = p.toLowerCase();
      if (lp === lowerTarget || lp === lowerFallback || lp.endsWith("/" + lowerFallback)) {
        matched = f;
      }
    });
    return matched;
  }

  function mimeForPath(path) {
    const ext = String(path || "").split(".").pop().toLowerCase();
    if (ext === "svg") return "image/svg+xml";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "gif") return "image/gif";
    return "application/octet-stream";
  }

  async function extractArchiveExtras(zip, baseDir, modData) {
    const extras = {
      league: null,
      teams: [],
      playersCount: 0,
      coachesCount: 0,
      scheduleDays: 0,
      scheduleGames: 0,
    };

    try {
      const rosterEntry = resolveZipFile(zip, baseDir, modData.roster || "roster.json");
      if (rosterEntry) {
        const roster = JSON.parse(await rosterEntry.async("string"));
        if (roster && typeof roster.league === "object" && roster.league) {
          extras.league = {
            name: roster.league.name || "",
            season: roster.league.season || "",
            gamesPerTeam: Number(roster.league.gamesPerTeam) || 0,
            salaryCap: Number(roster.league.salaryCap) || 0,
          };
        }
        const rawTeams = Array.isArray(roster && roster.teams) ? roster.teams : [];
        const teams = await Promise.all(
          rawTeams.map(async function (t) {
            const players = Array.isArray(t.players) ? t.players.length : 0;
            const coaches = Array.isArray(t.coaches) ? t.coaches : [];
            const head =
              coaches.find(function (c) { return c && c.role === "head"; }) || coaches[0] || null;

            let logoUrl = "";
            if (t.logo) {
              const lf = resolveZipFile(zip, baseDir, t.logo);
              if (lf) {
                try {
                  const ab = await lf.async("arraybuffer");
                  const blob = new Blob([ab], { type: mimeForPath(lf.name) });
                  logoUrl = URL.createObjectURL(blob);
                } catch (_) {
                  logoUrl = "";
                }
              }
            }

            return {
              id: t.id || "",
              name: t.name || "Клуб",
              short: t.short || "",
              city: t.city || "",
              conference: t.conference || "",
              division: t.division || "",
              playersCount: players,
              coachesCount: coaches.length,
              headCoach: head && head.name ? String(head.name) : "",
              logoUrl: logoUrl,
            };
          })
        );

        extras.teams = teams;
        extras.playersCount = teams.reduce(function (acc, t) { return acc + t.playersCount; }, 0);
        extras.coachesCount = teams.reduce(function (acc, t) { return acc + t.coachesCount; }, 0);
      }
    } catch (_) {
      // Optional roster
    }

    try {
      const schedEntry = resolveZipFile(zip, baseDir, modData.schedule || "schedule.json");
      if (schedEntry) {
        const sched = JSON.parse(await schedEntry.async("string"));
        extras.scheduleDays = Number(sched && sched.days) || 0;
        extras.scheduleGames = Array.isArray(sched && sched.games) ? sched.games.length : 0;
      }
    } catch (_) {
      // Optional schedule
    }

    return extras;
  }

  async function readRepoMod(entry) {
    const urls = candidateUrls(entry.file);
    const res = await fetchFirst(urls);
    const headerSize = Number(res.headers.get("content-length")) || 0;
    const buf = await res.arrayBuffer();
    const size = headerSize || buf.byteLength;

    const zip = await JSZip.loadAsync(buf);
    const path = findModJson(zip);
    if (!path) throw new Error("В архиве не найден mod.json");

    const baseDir = path.indexOf("/") !== -1 ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const data = JSON.parse(await zip.file(path).async("string"));
    const extras = await extractArchiveExtras(zip, baseDir, data);

    return Object.assign(
      {
        name: entry.file.split("/").pop().replace(/\.zip$/i, ""),
        description: "",
        author: null,
        version: "",
      },
      data,
      {
        _download: urls[0],
        _fileName: (entry.file || "").split("/").pop(),
        _size: size,
        _source: "repo",
        _extras: extras,
      }
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
      {
        _download: driveDownload(entry.url),
        _fileName: "",
        _size: 0,
        _source: "drive",
        _extras: null,
      }
    );
  }

  async function loadMod(entry, idx) {
    try {
      const loaded = entry.source === "drive" ? readDriveMod(entry) : await readRepoMod(entry);
      loaded._idx = idx;
      return loaded;
    } catch (e) {
      return Object.assign({}, entry, {
        _idx: idx,
        name: entry.name || (entry.file || "Мод").split("/").pop(),
        description: "Не удалось загрузить архив мода (" + e.message + ").",
        _error: true,
        _download:
          entry.source === "drive"
            ? driveDownload(entry.url)
            : candidateUrls(entry.file || "")[0],
        _source: entry.source || "repo",
        _extras: null,
      });
    }
  }

  // ---------- Mod Card Rendering ----------
  function buildFactsHtml(m) {
    const ex = m._extras;
    const items = [];

    if (ex && ex.teams.length) {
      items.push(
        `<span class="mod-fact"><strong>${ex.teams.length}</strong> ${pluralRu(
          ex.teams.length,
          "клуб",
          "клуба",
          "клубов"
        )}</span>`
      );
    }
    if (ex && ex.playersCount > 0) {
      items.push(
        `<span class="mod-fact"><strong>${ex.playersCount}</strong> ${pluralRu(
          ex.playersCount,
          "игрок",
          "игрока",
          "игроков"
        )}</span>`
      );
    }
    if (ex && ex.coachesCount > 0) {
      items.push(
        `<span class="mod-fact"><strong>${ex.coachesCount}</strong> ${pluralRu(
          ex.coachesCount,
          "тренер",
          "тренера",
          "тренеров"
        )}</span>`
      );
    }
    if (ex && ex.scheduleGames > 0) {
      items.push(
        `<span class="mod-fact"><strong>${ex.scheduleGames}</strong> ${pluralRu(
          ex.scheduleGames,
          "матч",
          "матча",
          "матчей"
        )} в календаре</span>`
      );
    } else if (ex && ex.league && ex.league.gamesPerTeam > 0) {
      items.push(
        `<span class="mod-fact"><strong>${ex.league.gamesPerTeam}</strong> ${pluralRu(
          ex.league.gamesPerTeam,
          "матч",
          "матча",
          "матчей"
        )} в регулярке</span>`
      );
    }
    if (ex && ex.league && ex.league.salaryCap > 0) {
      items.push(`<span class="mod-fact">Потолок <strong>${esc(fmtRub(ex.league.salaryCap))}</strong></span>`);
    }
    if (m.author) {
      items.push(`<span class="mod-fact">Автор: <strong>${esc(m.author)}</strong></span>`);
    }

    if (!items.length) return "";
    return `<div class="mod-facts">${items.join(
      '<span class="mod-fact-sep" aria-hidden="true">·</span>'
    )}</div>`;
  }

  function buildCrestsStripHtml(m) {
    const ex = m._extras;
    if (!ex || !ex.teams.length) return "";

    const limit = 10;
    const shown = ex.teams.slice(0, limit);
    const remaining = ex.teams.length - shown.length;

    const badges = shown
      .map(function (t, i) {
        const title = [t.name, t.city].filter(Boolean).join(" · ");
        const key = t.id || String(i);
        const content = t.logoUrl
          ? `<img src="${esc(t.logoUrl)}" alt="${esc(t.name)}" width="26" height="26" loading="lazy" />`
          : `<span class="crest-initials">${esc(initials(t.short || t.name))}</span>`;
        return `<button type="button" class="crest-item" data-open-mod="${m._idx}" data-club-key="${esc(key)}" title="${esc(title)}" aria-label="${esc(title)}">${content}</button>`;
      })
      .join("");

    const moreBtn =
      remaining > 0
        ? `<button type="button" class="crest-more" data-open-mod="${m._idx}">+ ещё ${remaining}</button>`
        : "";

    return `<div class="crests-strip">${badges}${moreBtn}</div>`;
  }

  function card(m) {
    const ex = m._extras;
    const hasTeams = Boolean(ex && ex.teams.length);
    const cls = "mod-card" + (m._error ? " is-error" : "");

    const verHtml = m.version ? `<span class="mod-ver">v${esc(m.version)}</span>` : "";
    const rightParts = [];
    if (m._source === "drive") {
      rightParts.push("Google Диск");
    } else {
      rightParts.push("ZIP");
    }
    if (m._size) rightParts.push(fmtSize(m._size));

    const dlText = m._error
      ? "Открыть ссылку"
      : m._source === "drive"
      ? "Скачать с Google Диска"
      : "Скачать архив (.zip)";
    const sizeInline = !m._error && m._size ? ` <span class="btn-sub">· ${esc(fmtSize(m._size))}</span>` : "";

    const inspectBtn = hasTeams
      ? `<button type="button" class="btn-secondary" data-open-mod="${m._idx}">Список клубов (${ex.teams.length})</button>`
      : "";

    return `
      <article class="${cls}">
        <div class="mod-top">
          <div class="mod-heading">
            <h3 class="mod-title">${esc(m.name)}</h3>
            ${verHtml}
          </div>
          <span class="mod-file-meta">${esc(rightParts.join(" · "))}</span>
        </div>
        ${m.description ? `<p class="mod-desc">${esc(m.description)}</p>` : ""}
        ${buildFactsHtml(m)}
        ${buildCrestsStripHtml(m)}
        <div class="mod-footer">
          <a class="btn-primary" href="${esc(m._download)}" download>
            ${ICONS.download}
            <span>${dlText}${sizeInline}</span>
          </a>
          ${inspectBtn}
        </div>
      </article>`;
  }

  function render(list, query) {
    if (!list.length) {
      if (query) {
        listEl.innerHTML = `
          <div class="empty-box">
            <h3>По запросу «${esc(query)}» ничего не найдено</h3>
            <p>Попробуйте ввести другое название клуба, города или лиги.</p>
            <button type="button" class="btn-secondary" id="resetSearchBtn">Сбросить поиск</button>
          </div>`;
        const resetBtn = document.getElementById("resetSearchBtn");
        if (resetBtn) {
          resetBtn.addEventListener("click", function () {
            if (searchInput) searchInput.value = "";
            if (searchClear) searchClear.hidden = true;
            applyFilter("");
          });
        }
      } else {
        listEl.innerHTML = `
          <div class="empty-box">
            <h3>Список модов пока пуст</h3>
            <p>Добавьте архив в <code>manifest.json</code>, чтобы он появился на сайте.</p>
          </div>`;
      }
      return;
    }

    listEl.innerHTML = list.map(card).join("");
  }

  function modSearchCorpus(m) {
    const parts = [m.name, m.description, m.author, m.version, m._fileName];
    if (m._extras) {
      if (m._extras.league) {
        parts.push(m._extras.league.name, m._extras.league.season);
      }
      m._extras.teams.forEach(function (t) {
        parts.push(t.name, t.short, t.city, t.conference, t.division, t.headCoach);
      });
    }
    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function applyFilter(rawQuery) {
    const q = (rawQuery || "").trim().toLowerCase();
    if (searchClear) searchClear.hidden = !q;
    if (!q) {
      render(ALL_MODS, "");
      return;
    }
    const filtered = ALL_MODS.filter(function (m) {
      return modSearchCorpus(m).includes(q);
    });
    render(filtered, rawQuery.trim());
  }

  // ---------- Game Download Section ----------
  function gameIconFor(url, file, label) {
    const s = [url, file, label].filter(Boolean).join(" ").toLowerCase();
    if (s.indexOf("apk") !== -1 || s.indexOf("android") !== -1) return ICONS.android;
    if (s.indexOf("portable") !== -1 || s.indexOf("портатив") !== -1) return ICONS.portable;
    if (s.indexOf(".exe") !== -1 || s.indexOf("setup") !== -1 || s.indexOf("windows") !== -1) return ICONS.windows;
    return ICONS.file;
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
        const icon = gameIconFor(l.url, l.file, l.label);
        return `
          <a class="dl-tile" href="${esc(l.url)}" download>
            <span class="dl-ico">${icon}</span>
            <span class="dl-body">
              <span class="dl-label">${esc(label)}</span>
              ${fn ? `<span class="dl-file">${esc(fn)}</span>` : ""}
            </span>
            <span class="dl-arrow">${ICONS.arrowDown}</span>
          </a>`;
      })
      .join("");
  }

  // ---------- Modals ----------
  function syncBodyLock() {
    const anyOpen = Array.from(document.querySelectorAll(".modal-backdrop")).some(function (el) {
      return !el.hidden;
    });
    document.body.classList.toggle("modal-open", anyOpen);
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    syncBodyLock();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    syncBodyLock();
  }

  function openModDetail(idx, clubKey) {
    const m = ALL_MODS.find(function (x) { return x._idx === Number(idx); });
    const modal = document.getElementById("modDetailModal");
    const kicker = document.getElementById("detailKicker");
    const title = document.getElementById("detailTitle");
    const body = document.getElementById("detailBody");
    const foot = document.getElementById("detailFoot");
    if (!m || !m._extras || !modal || !body || !foot) return;

    const ex = m._extras;
    const lgLine =
      ex.league && (ex.league.name || ex.league.season)
        ? [ex.league.name, ex.league.season].filter(Boolean).join(" · ")
        : "Состав архива";
    if (kicker) kicker.textContent = lgLine + (m.version ? " · v" + m.version : "");
    if (title) title.textContent = m.name;

    const chips = [];
    chips.push(`<div class="detail-chip">Клубов: <strong>${ex.teams.length}</strong></div>`);
    if (ex.playersCount > 0) {
      chips.push(`<div class="detail-chip">Игроков: <strong>${ex.playersCount}</strong></div>`);
    }
    if (ex.coachesCount > 0) {
      chips.push(`<div class="detail-chip">Тренеров: <strong>${ex.coachesCount}</strong></div>`);
    }
    if (ex.scheduleGames > 0) {
      chips.push(`<div class="detail-chip">Матчей в календаре: <strong>${ex.scheduleGames}</strong></div>`);
    }
    if (ex.league && ex.league.salaryCap > 0) {
      chips.push(`<div class="detail-chip">Потолок зарплат: <strong>${esc(fmtRub(ex.league.salaryCap))}</strong></div>`);
    }

    const groupMap = Object.create(null);
    ex.teams.forEach(function (t, teamIdx) {
      const key = t.conference || "Участники лиги";
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push({ team: t, key: t.id || String(teamIdx) });
    });

    const groups = sortConferences(Object.keys(groupMap)).map(function (k) {
      return { name: k, items: groupMap[k] };
    });

    const groupsHtml = groups
      .map(function (g) {
        const titleLabel =
          g.name === "Запад" || g.name === "Восток" ? "Конференция «" + g.name + "»" : g.name;
        const countLabel =
          g.items.length + " " + pluralRu(g.items.length, "клуб", "клуба", "клубов");

        const cards = g.items
          .map(function (item) {
            const t = item.team;
            const isHi = clubKey && item.key === clubKey;
            const cls = "club-card" + (isHi ? " is-highlighted" : "");
            const logo = t.logoUrl
              ? `<img src="${esc(t.logoUrl)}" alt="${esc(t.name)}" width="28" height="28" loading="lazy" />`
              : `<span class="crest-initials">${esc(initials(t.short || t.name))}</span>`;
            const metaParts = [];
            if (t.city) metaParts.push(t.city);
            if (t.headCoach) metaParts.push(t.headCoach);
            else if (t.playersCount) {
              metaParts.push(t.playersCount + " " + pluralRu(t.playersCount, "игрок", "игрока", "игроков"));
            }
            return `
              <div class="${cls}" data-detail-club="${esc(item.key)}">
                <div class="club-logo">${logo}</div>
                <div class="club-info">
                  <div class="club-name">${esc(t.name)}</div>
                  <div class="club-meta" title="${esc(metaParts.join(" · "))}">${esc(metaParts.join(" · "))}</div>
                </div>
              </div>`;
          })
          .join("");

        return `
          <section class="conf-section">
            <h3 class="conf-head">${esc(titleLabel)} <span>${esc(countLabel)}</span></h3>
            <div class="clubs-grid">${cards}</div>
          </section>`;
      })
      .join("");

    body.innerHTML = `<div class="detail-stats">${chips.join("")}</div>${groupsHtml}`;

    const fileMeta = [m._fileName, fmtSize(m._size)].filter(Boolean).join(" · ");
    foot.innerHTML = `
      <span class="modal-foot-info">${esc(fileMeta || "ZIP-архив для игры")}</span>
      <a class="btn-primary" href="${esc(m._download)}" download>
        ${ICONS.download}
        <span>Скачать архив (.zip)</span>
      </a>`;

    openModal(modal);

    if (clubKey) {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(clubKey) : clubKey;
      const targetRow = body.querySelector(`[data-detail-club="${escaped}"]`);
      if (targetRow && typeof targetRow.scrollIntoView === "function") {
        targetRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else {
      body.scrollTop = 0;
    }
  }

  function setupInteractions() {
    const howModal = document.getElementById("howModal");
    const howBtn = document.getElementById("howBtn");
    const footerHowBtn = document.getElementById("footerHowBtn");
    const howClose = document.getElementById("howClose");

    const detailModal = document.getElementById("modDetailModal");
    const detailClose = document.getElementById("detailClose");

    const showHow = function (e) {
      if (e) e.preventDefault();
      openModal(howModal);
    };

    if (howBtn) howBtn.addEventListener("click", showHow);
    if (footerHowBtn) footerHowBtn.addEventListener("click", showHow);
    if (howClose) howClose.addEventListener("click", function () { closeModal(howModal); });
    if (detailClose) detailClose.addEventListener("click", function () { closeModal(detailModal); });

    [howModal, detailModal].forEach(function (backdrop) {
      if (!backdrop) return;
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) closeModal(backdrop);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeModal(detailModal);
        closeModal(howModal);
      }
    });

    document.addEventListener("click", function (e) {
      const openTrigger = e.target.closest("[data-open-mod]");
      if (openTrigger) {
        e.preventDefault();
        openModDetail(
          openTrigger.getAttribute("data-open-mod"),
          openTrigger.getAttribute("data-club-key") || ""
        );
        return;
      }

      const copyBtn = e.target.closest("[data-copy-target]");
      if (copyBtn) {
        const targetId = copyBtn.getAttribute("data-copy-target");
        const codeEl = targetId ? document.getElementById(targetId) : null;
        if (codeEl && navigator.clipboard) {
          navigator.clipboard.writeText(codeEl.textContent || "").then(function () {
            const orig = copyBtn.textContent;
            copyBtn.textContent = "Скопировано";
            copyBtn.classList.add("copied");
            setTimeout(function () {
              copyBtn.textContent = orig;
              copyBtn.classList.remove("copied");
            }, 1500);
          });
        }
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    setupInteractions();

    let manifest;
    try {
      const res = await fetchFirst(candidateUrls("manifest.json"));
      manifest = await res.json();
    } catch (e) {
      listEl.innerHTML =
        '<div class="empty-box"><h3>Не удалось загрузить manifest.json</h3><p>' +
        esc(e.message) +
        "</p></div>";
      if (statCount) statCount.textContent = "";
      return;
    }

    if (manifest.title && heroTitle) heroTitle.textContent = manifest.title;
    if (manifest.subtitle && heroSub) heroSub.textContent = manifest.subtitle;
    document.title = manifest.title || "HockeyManager — Моды";

    renderGame(manifest.game);

    const entries = Array.isArray(manifest.mods) ? manifest.mods : [];
    const mods = await Promise.all(entries.map(loadMod));
    ALL_MODS = mods;

    if (statCount) {
      statCount.textContent =
        mods.length + " " + pluralRu(mods.length, "мод", "мода", "модов");
    }

    render(ALL_MODS, "");

    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        applyFilter(e.target.value);
      });
    }
    if (searchClear && searchInput) {
      searchClear.addEventListener("click", function () {
        searchInput.value = "";
        searchInput.focus();
        applyFilter("");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
