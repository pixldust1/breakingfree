export const prerender = false;

import { GET as getDownloadGET } from "./get-download";

type PackageParam = "essentials" | "complete";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function getEnv(locals: unknown): Record<string, string | undefined> | undefined {
  const runtimeEnv = (locals as any)?.runtime?.env;
  if (runtimeEnv && typeof runtimeEnv === "object") return runtimeEnv;
  return undefined;
}

function getPlunkApiKey(locals: unknown): string | undefined {
  return getEnv(locals)?.PLUNK_API_KEY || (import.meta as any)?.env?.PLUNK_API_KEY;
}

async function safeTrackPlunkEvent(params: {
  apiKey: string | undefined;
  email: string;
  pkg: PackageParam;
  firstName?: string;
  lastName?: string;
  payerID?: string;
  downloadUrl?: string;
}) {
  if (!params.apiKey) {
    console.warn("[purchase-confirm] PLUNK_API_KEY missing; skipping Plunk track");
    return { ok: false as const, skipped: true as const };
  }

  const event =
    params.pkg === "complete" ? "complete-package-purchased" : "essentials-purchased";

  try {
    const res = await fetch("https://api.useplunk.com/v1/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event,
        email: params.email,
        data: {
          first_name: params.firstName || "",
          last_name: params.lastName || "",
          paypal_payer_id: params.payerID || "",
          package: params.pkg,
          download_url: params.downloadUrl || "",
        },
        subscribed: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[purchase-confirm] Plunk track failed", res.status, text);
      return { ok: false as const, skipped: false as const };
    }

    return { ok: true as const, skipped: false as const };
  } catch (err) {
    console.error("[purchase-confirm] Plunk track error", err);
    return { ok: false as const, skipped: false as const };
  }
}

export async function POST({ request, locals }: { request: Request; locals: unknown }) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const pkg = body?.package;

  if (!email) return json({ error: "Missing email" }, { status: 400 });
  if (pkg !== "essentials" && pkg !== "complete") {
    return json({ error: "Missing or invalid package" }, { status: 400 });
  }

  // Always sign first (download must work even if email fails)
  const getDownloadUrl = new URL("/api/get-download", request.url);
  getDownloadUrl.searchParams.set("package", pkg);

  const signedRes = await getDownloadGET({
    request: new Request(getDownloadUrl.toString(), { method: "GET" }),
    locals,
  } as any);

  const signedText = await signedRes.text();
  if (!signedRes.ok) {
    // If signing fails, we do need to fail the request (download cannot work)
    return new Response(signedText, {
      status: signedRes.status,
      headers: { "content-type": signedRes.headers.get("content-type") ?? "application/json" },
    });
  }

  let signedJson: any;
  try {
    signedJson = JSON.parse(signedText);
  } catch {
    return json(
      { error: "Invalid get-download response", details: signedText },
      { status: 502 },
    );
  }

  const downloadUrl =
    typeof signedJson?.url === "string" ? (signedJson.url as string) : undefined;

  // Best-effort Plunk (never blocks download)
  const plunkApiKey = getPlunkApiKey(locals);
  const plunk = await safeTrackPlunkEvent({
    apiKey: plunkApiKey,
    email,
    pkg,
    firstName: typeof body?.firstName === "string" ? body.firstName : "",
    lastName: typeof body?.lastName === "string" ? body.lastName : "",
    payerID: typeof body?.payerID === "string" ? body.payerID : "",
    downloadUrl,
  });

  return json({
    success: true,
    package: pkg,
    downloadUrl,
    emailQueued: plunk.ok,
    emailSkipped: plunk.skipped,
  });
}

