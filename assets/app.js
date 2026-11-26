/* HockeyManager mods — frontend logic
 * - Loads manifest.json
 * - For repo zips: fetches the archive, inspects mod.json + optional roster.json /
 *   schedule.json / club logos with JSZip right in the browser
 * - For Google Drive links: uses metadata provided in the manifest
 * All fetches resolve relative to the site root and work on GitHub Pages
 * project subpaths, custom domains and local previews alike.
 */
(function () {
  "use strict";

  const grid = document.getElementById("mods");
  const searchInput = document.getElementById("search");
  const searchClear = document.getElementById("searchClear");
  const heroTitle = document.getElementById("heroTitle");
  const heroSub = document.getElementById("heroSubtitle");
  const statCount = document.getElementById("statCount");
  const heroModBadge = document.getElementById("heroModBadge");

  let ALL_MODS = [];

  // ---------- Russian pluralization & formatters ----------
  function pluralRu(n, one, two, five) {
    const abs = Math.abs(n) % 100;
    const n1 = abs % 10;
    if (abs > 10 && abs < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    const n = Number(bytes);
    if (!n) return "";
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
    if (n >= 1e6) {
      return Math.round(n / 1e6) + " млн ₽";
    }
    return n.toLocaleString("ru-RU") + " ₽";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function safeHex(c) {
    return typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : "";
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "ХК";
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // ---------- Inline SVG Icons ----------
  const ICONS = {
    download:
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5V10.5M8 10.5L4.75 7.25M8 10.5L11.25 7.25M3 13H13" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check:
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.8 7.3L5.6 10.1L11.2 4.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    list:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5H13.5M2.5 8H13.5M2.5 11.5H9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    windows:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.8 4.6L9.1 3.7V9.4H2.8V4.6ZM10.2 3.55L17.2 2.5V9.4H10.2V3.55ZM2.8 10.5H9.1V16.25L2.8 15.35V10.5ZM10.2 10.5H17.2V17.5L10.2 16.45V10.5Z" fill="currentColor"/></svg>',
    portable:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="13" height="10.5" rx="1.8" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 6V3.5H13.5V6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11.2H12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    android:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.2 13.5C4.2 10.1 6.8 7.4 10 7.4C13.2 7.4 15.8 10.1 15.8 13.5V14.8H4.2V13.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.8 7.8L5.1 5.1M13.2 7.8L14.9 5.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7.8" cy="11.3" r="0.9" fill="currentColor"/><circle cx="12.2" cy="11.3" r="0.9" fill="currentColor"/></svg>',
    file:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 3.5H11.5L15 7V16.5H5V3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.2 3.5V7.2H15" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
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
      hasRoster: false,
      hasSchedule: false,
      hasLogos: false,
      scheduleDays: 0,
      scheduleGames: 0,
    };

    // 1. Parse roster.json if available
    try {
      const rosterEntry = resolveZipFile(zip, baseDir, modData.roster || "roster.json");
      if (rosterEntry) {
        const rosterText = await rosterEntry.async("string");
        const roster = JSON.parse(rosterText);
        extras.hasRoster = true;
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
              primaryColor: safeHex(t.primaryColor),
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
        extras.hasLogos = teams.some(function (t) { return Boolean(t.logoUrl); });
      }
    } catch (_) {
      // Ignore optional roster parsing issues so mod still renders from mod.json
    }

    // 2. Parse schedule.json if available
    try {
      const schedEntry = resolveZipFile(zip, baseDir, modData.schedule || "schedule.json");
      if (schedEntry) {
        const schedText = await schedEntry.async("string");
        const sched = JSON.parse(schedText);
        extras.hasSchedule = true;
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
    if (!path) throw new Error("В архиве не найден файл mod.json");

    const baseDir = path.indexOf("/") !== -1 ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const text = await zip.file(path).async("string");
    const data = JSON.parse(text);
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
        description: "Не удалось прочитать архив мода (" + e.message + ").",
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
  function buildMetricsHtml(ex) {
    if (!ex || !ex.teams.length) return "";
    const cells = [];
    cells.push({
      val: ex.teams.length,
      lbl: pluralRu(ex.teams.length, "клуб", "клуба", "клубов"),
    });
    if (ex.playersCount > 0) {
      cells.push({
        val: ex.playersCount,
        lbl: pluralRu(ex.playersCount, "игрок", "игрока", "игроков"),
      });
    }
    if (ex.coachesCount > 0) {
      cells.push({
        val: ex.coachesCount,
        lbl: pluralRu(ex.coachesCount, "тренер", "тренера", "тренеров"),
      });
    }
    if (ex.league && ex.league.gamesPerTeam > 0) {
      cells.push({
        val: ex.league.gamesPerTeam,
        lbl: pluralRu(ex.league.gamesPerTeam, "матч клуба", "матча клуба", "матчей клуба"),
      });
    } else if (ex.scheduleGames > 0) {
      cells.push({
        val: ex.scheduleGames,
        lbl: pluralRu(ex.scheduleGames, "матч сезона", "матча сезона", "матчей сезона"),
      });
    }
    return `<div class="mod-metrics">${cells
      .map(function (c) {
        return `<div class="metric-cell"><span class="metric-val">${esc(c.val)}</span><span class="metric-lbl">${esc(c.lbl)}</span></div>`;
      })
      .join("")}</div>`;
  }

  function buildMetaRowHtml(m) {
    const ex = m._extras;
    const parts = [];

    if (ex && ex.hasRoster) {
      parts.push(`<span class="meta-check">${ICONS.check}<span>Полные составы</span></span>`);
    }
    if (ex && ex.hasSchedule) {
      const daysTxt = ex.scheduleDays ? ` (${ex.scheduleDays} дн.)` : "";
      parts.push(`<span class="meta-check">${ICONS.check}<span>Календарь сезона${esc(daysTxt)}</span></span>`);
    }
    if (ex && ex.hasLogos) {
      parts.push(`<span class="meta-check">${ICONS.check}<span>Эмблемы клубов</span></span>`);
    }
    if (ex && ex.league && ex.league.salaryCap > 0) {
      parts.push(`<span class="meta-author">Потолок ФОТ: <b>${esc(fmtRub(ex.league.salaryCap))}</b></span>`);
    }
    if (m.author) {
      parts.push(`<span class="meta-author">Автор: <b>${esc(m.author)}</b></span>`);
    }

    if (!parts.length) return "";
    return `<div class="mod-meta-row">${parts.join("")}</div>`;
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

  function buildShowcaseHtml(m) {
    const ex = m._extras;
    if (!ex || !ex.teams.length) return "";

    const previewTeams = ex.teams.slice(0, 24);
    const confSet = sortConferences(
      Array.from(
        new Set(
          ex.teams
            .map(function (t) { return t.conference; })
            .filter(Boolean)
        )
      )
    );
    const confLabel = confSet.length ? confSet.join(" · ") : "Все участники";

    const crests = previewTeams
      .map(function (t, teamIdx) {
        const title = [t.name, t.city].filter(Boolean).join(" — ");
        const style = t.primaryColor ? ` style="--club-color:${esc(t.primaryColor)}"` : "";
        const clubKey = t.id || String(teamIdx);
        const inner = t.logoUrl
          ? `<img src="${esc(t.logoUrl)}" alt="${esc(t.name)}" loading="lazy" />`
          : `<span class="crest-fallback">${esc(initials(t.short || t.name))}</span>`;
        return `<button type="button" class="crest-btn" data-open-mod="${m._idx}" data-club-key="${esc(clubKey)}" title="${esc(title)}" aria-label="${esc(title)}"${style}>${inner}</button>`;
      })
      .join("");

    const extraCount = ex.teams.length - previewTeams.length;
    const footLeft =
      extraCount > 0
        ? `Показано ${previewTeams.length} из ${ex.teams.length}`
        : `${ex.teams.length} ${pluralRu(ex.teams.length, "клуб", "клуба", "клубов")} в базе`;

    return `
      <div class="mod-showcase">
        <div class="showcase-head">
          <span class="showcase-title">Клубы в архиве</span>
          <span class="showcase-confs">${esc(confLabel)}</span>
        </div>
        <div class="crests-grid">${crests}</div>
        <div class="showcase-foot">
          <span>${esc(footLeft)}</span>
          <button type="button" class="showcase-open-link" data-open-mod="${m._idx}">
            <span>Все клубы и тренеры</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>`;
  }

  function card(m) {
    const ex = m._extras;
    const hasShowcase = Boolean(ex && ex.teams.length);
    const cls = ["mod-card"];
    if (hasShowcase) cls.push("has-showcase");
    if (m._error) cls.push("is-error");

    const badges = [];
    if (ex && ex.league && (ex.league.name || ex.league.season)) {
      const lg = [ex.league.name, ex.league.season].filter(Boolean).join(" · ");
      badges.push(`<span class="badge badge-league">${esc(lg)}</span>`);
    }
    if (m.version) {
      badges.push(`<span class="badge badge-ver">v${esc(m.version)}</span>`);
    }
    const srcText = m._source === "drive" ? "Google Диск" : "ZIP-архив";
    badges.push(`<span class="badge badge-source">${srcText}</span>`);

    const sizeTag = m._size ? `<span class="dl-size">${esc(fmtSize(m._size))}</span>` : "";
    const dlLabel = m._error
      ? "Открыть прямую ссылку"
      : m._source === "drive"
      ? "Скачать с Google Диска"
      : "Скачать мод (.zip)";

    const inspectBtn = hasShowcase
      ? `<button type="button" class="btn-inspect" data-open-mod="${m._idx}">
           ${ICONS.list}
           <span>Состав лиги (${ex.teams.length})</span>
         </button>`
      : "";

    return `
      <article class="${cls.join(" ")}">
        <div class="mod-main">
          <div class="mod-badges">${badges.join("")}</div>
          <h3 class="mod-title">${esc(m.name)}</h3>
          ${m.description ? `<p class="mod-desc">${esc(m.description)}</p>` : ""}
          ${buildMetricsHtml(ex)}
          ${buildMetaRowHtml(m)}
          <div class="mod-actions">
            <a class="btn-download" href="${esc(m._download)}" download>
              ${ICONS.download}
              <span>${dlLabel}</span>
              ${sizeTag}
            </a>
            ${inspectBtn}
          </div>
        </div>
        ${buildShowcaseHtml(m)}
      </article>`;
  }

  function render(list, query) {
    grid.classList.toggle("mods-grid--single", list.length <= 1);
    grid.classList.toggle("mods-grid--multi", list.length > 1);

    if (!list.length) {
      if (query) {
        grid.innerHTML = `
          <div class="empty-state">
            <h3>По запросу «${esc(query)}» ничего не нашлось</h3>
            <p>Попробуйте ввести название другого клуба, города или лиги.</p>
            <button type="button" class="empty-reset" id="resetSearchBtn">Сбросить фильтр</button>
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
        grid.innerHTML = `
          <div class="empty-state">
            <h3>Каталог пока пуст</h3>
            <p>Добавьте первый архив в <code>manifest.json</code>, чтобы он появился на странице.</p>
          </div>`;
      }
      return;
    }

    grid.innerHTML = list.map(card).join("");
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

  // ---------- Game download section ----------
  function gamePlatformMeta(url, file, label) {
    const s = [url, file, label].filter(Boolean).join(" ").toLowerCase();
    if (s.indexOf("apk") !== -1 || s.indexOf("android") !== -1) {
      return {
        icon: ICONS.android,
        tag: "Android 7+",
        hint: "Прямая установка на смартфон или планшет, полноэкранный альбомный режим.",
      };
    }
    if (s.indexOf("portable") !== -1 || s.indexOf("портатив") !== -1) {
      return {
        icon: ICONS.portable,
        tag: "Windows · Без установки",
        hint: "Одиночный исполняемый файл: запускается сразу из любой папки или с флешки.",
      };
    }
    if (s.indexOf(".exe") !== -1 || s.indexOf("setup") !== -1 || s.indexOf("windows") !== -1) {
      return {
        icon: ICONS.windows,
        tag: "Windows 10 / 11",
        hint: "Стандартный установщик с выбором папки и созданием ярлыка на рабочем столе.",
      };
    }
    return {
      icon: ICONS.file,
      tag: "Сборка игры",
      hint: "Прямая загрузка дистрибутива.",
    };
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
        const meta = gamePlatformMeta(l.url, l.file, l.label);
        const hint = l.description || meta.hint;
        return `
          <a class="game-card" href="${esc(l.url)}" download>
            <div class="game-card-top">
              <span class="game-plat-icon">${meta.icon}</span>
              <span class="game-card-info">
                <span class="game-card-tag">${esc(meta.tag)}</span>
                <span class="game-card-title">${esc(label)}</span>
                <p class="game-card-hint">${esc(hint)}</p>
              </span>
            </div>
            <div class="game-card-foot">
              <span class="game-file">${esc(fn || "Прямая ссылка")}</span>
              <span class="game-dl-cta">Скачать ${ICONS.download}</span>
            </div>
          </a>`;
      })
      .join("");
  }

  // ---------- Modals (Docs & Archive Inspector) ----------
  function syncBodyLock() {
    const anyOpen = Array.from(document.querySelectorAll(".modal-backdrop")).some(function (el) {
      return !el.hidden;
    });
    document.body.classList.toggle("modal-open", anyOpen);
  }

  function openBackdrop(modal) {
    if (!modal) return;
    modal.hidden = false;
    syncBodyLock();
  }

  function closeBackdrop(modal) {
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

    // Summary pills
    const pills = [];
    pills.push(`<div class="detail-pill">Клубов: <strong>${ex.teams.length}</strong></div>`);
    if (ex.playersCount > 0) {
      pills.push(`<div class="detail-pill">Игроков в базе: <strong>${ex.playersCount}</strong></div>`);
    }
    if (ex.coachesCount > 0) {
      pills.push(`<div class="detail-pill">Тренеров: <strong>${ex.coachesCount}</strong></div>`);
    }
    if (ex.scheduleGames > 0) {
      pills.push(`<div class="detail-pill">Матчей регулярки: <strong>${ex.scheduleGames}</strong></div>`);
    }
    if (ex.league && ex.league.salaryCap > 0) {
      pills.push(`<div class="detail-pill">Потолок зарплат: <strong>${esc(fmtRub(ex.league.salaryCap))}</strong></div>`);
    }

    // Group teams by conference (West -> East)
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
            const cls = "club-row" + (isHi ? " is-highlighted" : "");
            const style = t.primaryColor ? ` style="--club-color:${esc(t.primaryColor)}"` : "";
            const logo = t.logoUrl
              ? `<img src="${esc(t.logoUrl)}" alt="${esc(t.name)}" loading="lazy" />`
              : `<span class="crest-fallback">${esc(initials(t.short || t.name))}</span>`;
            const subParts = [];
            if (t.city) subParts.push(t.city);
            if (t.division) subParts.push("див. " + t.division);
            if (t.playersCount) {
              subParts.push(
                t.playersCount + " " + pluralRu(t.playersCount, "игрок", "игрока", "игроков")
              );
            }
            const coachLine = t.headCoach ? ` · Гл. тр. ${t.headCoach}` : "";
            return `
              <div class="${cls}" data-detail-club="${esc(item.key)}"${style}>
                <div class="club-row-logo">${logo}</div>
                <div class="club-row-body">
                  <div class="club-row-name">${esc(t.name)}</div>
                  <div class="club-row-sub" title="${esc(subParts.join(" · ") + coachLine)}">${esc(subParts.join(" · ") + coachLine)}</div>
                </div>
              </div>`;
          })
          .join("");

        return `
          <section class="conf-block">
            <h3 class="conf-title">${esc(titleLabel)} <span>${esc(countLabel)}</span></h3>
            <div class="clubs-grid">${cards}</div>
          </section>`;
      })
      .join("");

    body.innerHTML = `<div class="detail-summary">${pills.join("")}</div>${groupsHtml}`;

    const fileMeta = [m._fileName, fmtSize(m._size)].filter(Boolean).join(" · ");
    foot.innerHTML = `
      <span class="modal-foot-meta">${esc(fileMeta || "ZIP-архив для установки через меню игры")}</span>
      <a class="btn-download" href="${esc(m._download)}" download>
        ${ICONS.download}
        <span>Скачать архив (.zip)</span>
      </a>`;

    openBackdrop(modal);

    if (clubKey) {
      const targetRow = body.querySelector(`[data-detail-club="${CSS.escape ? CSS.escape(clubKey) : clubKey}"]`);
      if (targetRow && typeof targetRow.scrollIntoView === "function") {
        targetRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else {
      body.scrollTop = 0;
    }
  }

  function setupModalsAndInteractions() {
    const howModal = document.getElementById("howModal");
    const howBtn = document.getElementById("howBtn");
    const footerHowBtn = document.getElementById("footerHowBtn");
    const howClose = document.getElementById("howClose");

    const detailModal = document.getElementById("modDetailModal");
    const detailClose = document.getElementById("detailClose");

    const openHow = function (e) {
      if (e) e.preventDefault();
      openBackdrop(howModal);
    };

    if (howBtn) howBtn.addEventListener("click", openHow);
    if (footerHowBtn) footerHowBtn.addEventListener("click", openHow);
    if (howClose) howClose.addEventListener("click", function () { closeBackdrop(howModal); });
    if (detailClose) detailClose.addEventListener("click", function () { closeBackdrop(detailModal); });

    [howModal, detailModal].forEach(function (backdrop) {
      if (!backdrop) return;
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) closeBackdrop(backdrop);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeBackdrop(detailModal);
        closeBackdrop(howModal);
      }
    });

    // Delegated clicks for opening mod details & copying snippets
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
            }, 1600);
          });
        }
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    setupModalsAndInteractions();

    let manifest;
    try {
      const res = await fetchFirst(candidateUrls("manifest.json"));
      manifest = await res.json();
    } catch (e) {
      grid.innerHTML =
        '<div class="empty-state"><h3>Не удалось загрузить manifest.json</h3><p>' +
        esc(e.message) +
        ". Проверьте, что файл опубликован в корне ветки.</p></div>";
      if (statCount) statCount.textContent = "Ошибка";
      return;
    }

    if (manifest.title && heroTitle) heroTitle.textContent = manifest.title;
    if (manifest.subtitle && heroSub) heroSub.textContent = manifest.subtitle;
    document.title = manifest.title || "HockeyManager — Моды";

    renderGame(manifest.game);

    const entries = Array.isArray(manifest.mods) ? manifest.mods : [];
    const mods = await Promise.all(entries.map(loadMod));
    ALL_MODS = mods;

    const countText = mods.length + " " + pluralRu(mods.length, "мод", "мода", "модов");
    if (statCount) statCount.textContent = countText;
    if (heroModBadge && mods.length > 0) {
      heroModBadge.textContent = mods.length;
      heroModBadge.hidden = false;
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
