// Receives Meta Lead Ad webhook events:
//   GET  → respond with hub.challenge for one-time verification
//   POST → fetch full lead via Graph API, push to Beehiiv, log to Sheet
//
// Required env vars (set in Vercel → Settings → Environment Variables):
//   META_WEBHOOK_VERIFY_TOKEN   long random string, also pasted into App Dashboard
//   META_ADS_ACCESS_TOKEN       60-day user token with leads_retrieval scope
//   BEEHIIV_API_KEY             Beehiiv API key
//   BEEHIIV_PUB_ID              pub_xxxxxxxx
//   SHEETS_WEBHOOK_URL          (optional) Google Apps Script web-app URL that
//                               appends each lead to the audit sheet. If unset,
//                               leads still sync to Beehiiv; the sheet step
//                               is just skipped silently.

const GRAPH_VERSION = "v21.0";

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

async function fetchLead(leadId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadId}?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function fieldDataToMap(fieldData = []) {
  const m = {};
  for (const f of fieldData) {
    const key = (f.name || "").toLowerCase();
    const val = Array.isArray(f.values) ? (f.values[0] || "") : "";
    m[key] = val;
  }
  return m;
}

async function pushToBeehiiv(email, fields, lead) {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUB_ID;
  if (!apiKey || !pubId) throw new Error("Beehiiv env vars missing");

  const payload = {
    email,
    reactivate_existing: true,
    send_welcome_email: true,
    utm_source: "meta-ads",
    utm_medium: "lead-form",
    utm_campaign: lead.campaign_name || "unknown",
    custom_fields: [
      { name: "Source", value: "Meta Lead Ad" },
      { name: "Campaign", value: lead.campaign_name || "" },
      { name: "Ad", value: lead.ad_name || "" },
      { name: "Full Name", value: fields.full_name || "" },
    ].filter((f) => f.value),
  };

  const r = await fetch(
    `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Beehiiv ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function pushToSheet(row) {
  const sheetUrl = process.env.SHEETS_WEBHOOK_URL;
  if (!sheetUrl) return { skipped: true };
  const r = await fetch(sheetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Sheet ${r.status}: ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  // === GET: webhook verification (one-time, when registering with Meta) ===
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && token && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  // === POST: process incoming lead event ===
  const body = await readBody(req);
  const accessToken = process.env.META_ADS_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ ok: false, error: "META_ADS_ACCESS_TOKEN not set" });
  }

  // Meta sends an envelope: { entry: [{ changes: [{ value: { leadgen_id, ... } }] }] }
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const results = [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const leadId = v.leadgen_id;
      if (!leadId) continue;

      try {
        const lead = await fetchLead(leadId, accessToken);
        const fields = fieldDataToMap(lead.field_data || []);
        const email = (fields.email || "").trim().toLowerCase();
        if (!email) {
          results.push({ leadId, ok: false, error: "no email in lead" });
          continue;
        }

        let beehiivOk = false, beehiivErr = null;
        try { await pushToBeehiiv(email, fields, lead); beehiivOk = true; }
        catch (e) { beehiivErr = e.message; }

        let sheetOk = false, sheetErr = null;
        try {
          const sr = await pushToSheet({
            timestamp: new Date().toISOString(),
            lead_id: leadId,
            created_time: lead.created_time || "",
            email,
            full_name: fields.full_name || "",
            campaign_id: lead.campaign_id || "",
            campaign_name: lead.campaign_name || "",
            adset_name: lead.adset_name || "",
            ad_name: lead.ad_name || "",
            form_id: lead.form_id || "",
            beehiiv_status: beehiivOk ? "synced" : "failed",
            beehiiv_error: beehiivErr || "",
            inbox_url: fields.inbox_url || "",
          });
          sheetOk = !sr.skipped ? true : false;
        } catch (e) { sheetErr = e.message; }

        results.push({ leadId, email, beehiivOk, beehiivErr, sheetOk, sheetErr });
      } catch (e) {
        results.push({ leadId, ok: false, error: e.message });
      }
    }
  }

  // Always 200 so Meta doesn't keep retrying when our processing fails on
  // a single lead — failures are surfaced via Vercel function logs + sheet.
  res.status(200).json({ ok: true, processed: results.length, results });
};
