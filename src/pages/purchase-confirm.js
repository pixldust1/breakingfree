// src/pages/api/purchase-confirm.js
// Astro API endpoint — handles post-purchase email + Supabase storage

const PLUNK_SECRET = "sk_44042e3c6a5c4be62f7be018ad7c449b619a6d5008691441";
const SUPABASE_URL = "https://dnhovfqrzxutexcrvtfk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuaG92ZnFyenh1dGV4Y3J2dGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTI2MTEsImV4cCI6MjA4OTA4ODYxMX0.Et8D5xarqrDreHeXvOwwnwDW5CGrnP3P5gDE6S5zNeo";

export const prerender = false;

export async function POST({ request }) {
  try {
    const { email, firstName, lastName, package: pkg, payerID } = await request.json();

    if (!email || !pkg) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const isComplete = pkg === "complete";
    const downloadUrl = isComplete
      ? "https://cloudflare-workers-autoconfig-breakingfree.sculpepperw.workers.dev/download-complete"
      : "https://cloudflare-workers-autoconfig-breakingfree.sculpepperw.workers.dev/download-essentials";
    const amount = isComplete ? 179 : 97;
    const productName = isComplete
      ? "Breaking Free System — Complete Package"
      : "Owner's Execution System — No Coding Required";

    // 1 — Save to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/breaking_free_customers`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        email,
        first_name: firstName || "",
        last_name: lastName || "",
        package: pkg,
        paypal_payer_id: payerID || "",
        amount_paid: amount,
        upsell_eligible: !isComplete,
        subscribed_newsletter: true
      })
    });

    // 2 — Track purchase event in Plunk (triggers confirmation email + sequences)
    await fetch("https://api.useplunk.com/v1/track", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PLUNK_SECRET}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event: isComplete ? "complete-package-purchased" : "essentials-purchased",
        email,
        data: {
          first_name: firstName || "Friend",
          product_name: productName,
          download_url: downloadUrl,
          pdf_password: "FREEDOM",
          amount: `$${amount}`,
          upsell_eligible: String(!isComplete)
        },
        subscribed: true
      })
    });

    return new Response(JSON.stringify({ success: true, downloadUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
