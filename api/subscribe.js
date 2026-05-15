// Branded subscribe form: posts {email} here, server-side calls Beehiiv.
// Keeps the API key server-side and the user on thelancasterledger.com.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-instance lightweight abuse guard: max 5 sign-ups from the same IP per
// 10 minutes. Not a substitute for a real WAF, just a speed bump.
const recent = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 5;

function clientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_IP) {
    recent.set(ip, arr);
    return true;
  }
  arr.push(now);
  recent.set(ip, arr);
  return false;
}

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUB_ID;
  if (!apiKey || !pubId) {
    return res.status(500).json({ ok: false, error: "server misconfigured" });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "slow down" });
  }

  const body = await readBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: "enter a valid email" });
  }

  // Forward client-side UTM tags if the visitor arrived from an ad with
  // them on the URL. Defaults preserve the prior "homepage / direct site"
  // attribution when no tags are present.
  const pick = (k, fallback) => {
    const v = String(body[k] || "").trim();
    return v && v.length < 200 ? v : fallback;
  };
  const utm = {
    utm_source:   pick("utm_source",   "thelancasterledger.com"),
    utm_medium:   pick("utm_medium",   "homepage"),
    utm_campaign: pick("utm_campaign", ""),
    utm_content:  pick("utm_content",  ""),
    utm_term:     pick("utm_term",     ""),
  };

  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: true,
          ...utm,
        }),
      }
    );
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      return res.status(502).json({
        ok: false,
        error: "beehiiv rejected",
        status: r.status,
        detail: errBody.slice(0, 200),
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
};
