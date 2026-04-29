/* =============================================================
   BEEHIIV LIVE DATA HYDRATION
   =============================================================
   Tiny client that pulls live numbers + the latest issue from
   YOUR proxy endpoint (never expose the Beehiiv API key to the
   browser). Proxy should forward to:

     GET /api/stats
       -> { subscribers: 552, issues_published: 142 }

     GET /api/latest
       -> {
            number: 142,
            date: "Wed, Apr 22, 2026",
            slug: "/2026/04/22",
            title: "The last banh mi at Sprout…",
            opener: "Good morning, Lancaster. …",
            bullets: ["…", "…", "…"],
            hero_image: "https://…"
          }

     GET /api/recent?limit=3
       -> [ { number, date, slug, title, bullets[] }, … ]

   Caching: proxy should cache 5 min for /stats, 60 s for /latest
   on issue days (Mon/Wed/Fri 06:00–08:00 ET), 5 min otherwise.
   On 6 AM send, a Beehiiv webhook can purge the cache so the
   site flips to the new issue instantly.
   ============================================================= */

(function () {
  const API = window.__LEDGER_API || ""; // e.g. "https://api.thelancasterledger.com"
  if (!API) return; // mock mode — static numbers stay

  // --- Subscriber count -------------------------------------------------
  fetch(API + "/api/stats")
    .then((r) => r.json())
    .then((d) => {
      document.querySelectorAll('[data-stat="subscribers"] strong')
        .forEach((el) => { el.textContent = new Intl.NumberFormat().format(d.subscribers); });
      document.querySelectorAll('[data-stat="issues"]')
        .forEach((el) => { el.textContent = d.issues_published; });
    })
    .catch(() => {});

  // --- Latest issue hero + bullets -------------------------------------
  fetch(API + "/api/latest")
    .then((r) => r.json())
    .then((d) => {
      // Hero title
      const t = document.querySelector("[data-live='hero-title']");
      if (t) t.innerHTML = d.title;

      // Hero opener
      const o = document.querySelector("[data-live='hero-opener']");
      if (o) o.textContent = d.opener.slice(0, 220) + "…";

      // Issue number + date
      document.querySelectorAll("[data-live='issue-no']")
        .forEach((el) => { el.textContent = "Issue N\u00ba " + d.number; });
      document.querySelectorAll("[data-live='issue-date']")
        .forEach((el) => { el.textContent = d.date; });

      // "In today's issue" bullets
      const list = document.querySelector("[data-live='today-bullets']");
      if (list && Array.isArray(d.bullets)) {
        list.innerHTML = d.bullets.map((b, i) => `
          <li class="live-bullet">
            <span class="live-num">0${i + 1}</span>
            <span>${b}</span>
          </li>`).join("");
      }

      // Read-button href
      document.querySelectorAll("[data-live='latest-link']")
        .forEach((el) => { el.setAttribute("href", d.slug || "issue.html"); });
    })
    .catch(() => {});
})();
