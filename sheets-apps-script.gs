// Google Apps Script: receives JSON POST from the Vercel Meta lead webhook
// and appends a row to the "Leads" tab of this spreadsheet.
//
// SETUP (one-time, ~3 minutes):
// 1. Create a new Google Sheet named "Lancaster Ledger - Lead Captures"
// 2. Add a tab named "Leads" with this header row in row 1:
//    timestamp | lead_id | created_time | email | full_name | campaign_name |
//    adset_name | ad_name | form_id | beehiiv_status | beehiiv_error |
//    inbox_url | campaign_id
// 3. Extensions → Apps Script → paste this whole file → Save
// 4. Deploy → New deployment → type: Web app
//    - Description: "Meta lead webhook receiver"
//    - Execute as: Me (your account)
//    - Who has access: Anyone
//    - Click Deploy
// 5. Copy the Web app URL (looks like https://script.google.com/macros/s/AKfy.../exec)
// 6. Set it as SHEETS_WEBHOOK_URL in Vercel env vars + redeploy the function

const TAB_NAME = "Leads";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "Tab '" + TAB_NAME + "' not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.lead_id || "",
      data.created_time || "",
      data.email || "",
      data.full_name || "",
      data.campaign_name || "",
      data.adset_name || "",
      data.ad_name || "",
      data.form_id || "",
      data.beehiiv_status || "",
      data.beehiiv_error || "",
      data.inbox_url || "",
      data.campaign_id || "",
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Optional: GET endpoint for sanity-checking the deployment URL in a browser
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: "Lancaster Ledger lead receiver online" }))
    .setMimeType(ContentService.MimeType.JSON);
}
