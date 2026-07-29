const fs = require("fs");
const path = require("path");
const axios = require("axios");

const USERNAME = "tfkcodes";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const UTC_OFFSET_HOURS = 3; // Africa/Dar_es_Salaam (EAT, UTC+3)

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const rest = axios.create({ baseURL: "https://api.github.com", headers });

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// We display Monday-first
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const LANG_COLORS = {
  Dart: "#58A6FF",
  TypeScript: "#3B82F6",
  JavaScript: "#F7DF1E",
  PHP: "#A78BFA",
  Python: "#3776AB",
  HTML: "#E34C26",
  CSS: "#563D7C",
  Swift: "#FA7343",
  Kotlin: "#7F52FF",
  Java: "#B07219",
  "C++": "#F34B7D",
  Go: "#00ADD8",
};
const FALLBACK_COLOR = "#8B98B8";

/**
 * Pulls the user's recent public activity (GitHub only exposes ~90 days /
 * up to ~300 events via this endpoint), tallies commit counts per weekday,
 * and per weekday tallies commits by the *primary language of the repo*
 * each push landed in (a practical stand-in for "language used that day" -
 * true per-commit, per-file language detection would need a diff fetch per
 * commit, which isn't viable within API rate limits).
 */
async function fetchWeeklyRhythm() {
  let page = 1;
  const events = [];
  while (page <= 3) {
    const { data } = await rest.get(
      `/users/${USERNAME}/events/public?per_page=100&page=${page}`,
    );
    if (!data.length) break;
    events.push(...data);
    if (data.length < 100) break;
    page += 1;
  }

  const pushEvents = events.filter((e) => e.type === "PushEvent");

  const repoLanguageCache = {};
  async function getRepoLanguage(repoFullName) {
    if (repoLanguageCache[repoFullName] !== undefined)
      return repoLanguageCache[repoFullName];
    try {
      const { data } = await rest.get(`/repos/${repoFullName}`);
      repoLanguageCache[repoFullName] = data.language || "Other";
    } catch {
      repoLanguageCache[repoFullName] = "Other";
    }
    return repoLanguageCache[repoFullName];
  }

  const commitsByDay = Array(7).fill(0);
  const langByDay = Array.from({ length: 7 }, () => ({}));

  for (const event of pushEvents) {
    const date = new Date(event.created_at);
    const localHours = date.getUTCHours() + UTC_OFFSET_HOURS;
    const localDate = new Date(date.getTime() + UTC_OFFSET_HOURS * 3600 * 1000);
    const dow = localDate.getUTCDay(); // 0=Sun..6=Sat
    const commitCount = (event.payload.commits || []).length || 1;

    commitsByDay[dow] += commitCount;

    const lang = await getRepoLanguage(event.repo.name);
    langByDay[dow][lang] = (langByDay[dow][lang] || 0) + commitCount;
  }

  const weekData = ORDER.map((dow) => {
    const total = commitsByDay[dow];
    const langs = langByDay[dow];
    let topLang = null;
    let topCount = 0;
    Object.entries(langs).forEach(([lang, count]) => {
      if (count > topCount) {
        topLang = lang;
        topCount = count;
      }
    });
    return {
      day: DAYS[dow],
      commits: total,
      topLang,
      topLangShare:
        total > 0 && topLang ? Math.round((topCount / total) * 100) : 0,
    };
  });

  return weekData;
}

function renderSVG(weekData) {
  const W = 900;
  const H = 320;
  const left = 60;
  const right = 60;
  const plotW = W - left - right;
  const step = plotW / 7;
  const centers = weekData.map((_, i) => left + step * i + step / 2);

  const barBase = 250;
  const barMaxH = 140;
  const maxCommits = Math.max(1, ...weekData.map((d) => d.commits));

  const lineTop = 90;
  const lineBottom = 230;

  const bars = weekData
    .map((d, i) => {
      const h = (d.commits / maxCommits) * barMaxH;
      const x = centers[i] - 22;
      const y = barBase - h;
      return `
      <rect x="${x}" y="${y}" width="44" height="${h}" rx="6" fill="#1B2A4A" stroke="#3B82F6" stroke-opacity="0.5"/>
      <text x="${centers[i]}" y="${y - 10}" text-anchor="middle" class="count">${d.commits}</text>`;
    })
    .join("");

  const points = weekData.map((d, i) => {
    const y =
      d.commits > 0
        ? lineBottom - (d.topLangShare / 100) * (lineBottom - lineTop)
        : lineBottom;
    return { x: centers[i], y, ...d };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const linePoints = points
    .map((p) => {
      if (!p.topLang) return "";
      const color = LANG_COLORS[p.topLang] || FALLBACK_COLOR;
      return `
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="${color}" stroke="#0A0E17" stroke-width="2"/>
      <text x="${p.x}" y="${p.y - 14}" text-anchor="middle" class="langLabel" fill="${color}">${p.topLang} ${p.topLangShare}%</text>`;
    })
    .join("");

  const dayLabels = weekData
    .map(
      (d, i) =>
        `<text x="${centers[i]}" y="272" text-anchor="middle" class="label">${d.day.toUpperCase()}</text>`,
    )
    .join("");

  const usedLangs = [
    ...new Set(weekData.map((d) => d.topLang).filter(Boolean)),
  ];
  const legend = usedLangs
    .map((lang, i) => {
      const color = LANG_COLORS[lang] || FALLBACK_COLOR;
      const x = 60 + i * 120;
      return `<circle cx="${x}" cy="298" r="4" fill="${color}"/><text x="${x + 10}" y="302" class="foot">${lang}</text>`;
    })
    .join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A0E17"/>
      <stop offset="100%" stop-color="#111A2E"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#58A6FF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#58A6FF" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#58A6FF" stop-opacity="0"/>
    </linearGradient>
    <style>
      .tag      { font: 700 11px 'Segoe UI', Arial, sans-serif; fill: #58A6FF; letter-spacing: 2.5px; }
      .handle   { font: 500 12px 'Segoe UI', Arial, sans-serif; fill: #4A5578; }
      .label    { font: 600 11px 'Segoe UI', Arial, sans-serif; fill: #7C8AAD; letter-spacing: 1px; }
      .count    { font: 700 13px 'Segoe UI', Arial, sans-serif; fill: #F3F6FC; }
      .langLabel{ font: 600 10px 'Segoe UI', Arial, sans-serif; }
      .foot     { font: 500 11px 'Segoe UI', Arial, sans-serif; fill: #9AA6C4; }
    </style>
  </defs>

  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="url(#bg)" stroke="#1E2740" stroke-width="1"/>
  <rect x="1" y="1" width="${W - 2}" height="3" rx="1.5" fill="url(#glow)"/>

  <text x="36" y="42" class="tag">WEEKLY CODING RHYTHM</text>
  <text x="${W - 36}" y="42" text-anchor="end" class="handle">@${USERNAME}</text>
  <line x1="36" y1="58" x2="${W - 36}" y2="58" stroke="#1E2740" stroke-width="1"/>

  <line x1="${left}" y1="${barBase}" x2="${W - right}" y2="${barBase}" stroke="#1E2740" stroke-width="1"/>

  ${bars}
  <path d="${path}" fill="none" stroke="#FBBF74" stroke-width="2" stroke-linecap="round"/>
  ${linePoints}
  ${dayLabels}

  <line x1="36" y1="284" x2="${W - 36}" y2="284" stroke="#1E2740" stroke-width="1"/>
  ${legend}
  <text x="${W - 36}" y="302" text-anchor="end" class="foot">bars = commits · line = top language share</text>
</svg>
`;
}

async function main() {
  let weekData;
  try {
    weekData = await fetchWeeklyRhythm();
  } catch (err) {
    console.error("Falling back, could not fetch live data:", err.message);
    weekData = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({
      day,
      commits: 0,
      topLang: null,
      topLangShare: 0,
    }));
  }

  const svg = renderSVG(weekData);
  const outPath = path.join(__dirname, "..", "assets", "weekly-chart.svg");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg);
  console.log("weekly-chart.svg regenerated");
}

main().catch((err) => {
  console.error("Failed to generate weekly chart:", err.message);
  process.exit(1);
});
