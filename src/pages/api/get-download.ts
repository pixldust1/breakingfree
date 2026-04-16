export const prerender = false;

const SUPABASE_URL = "https://dnhovfqrzxutexcrvtfk.supabase.co";
const BUCKET = "DOWNLOADS";

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

function getServiceRoleKey(locals: unknown): string | undefined {
  return (
    getEnv(locals)?.SUPABASE_SERVICE_ROLE_KEY ||
    (import.meta as any)?.env?.SUPABASE_SERVICE_ROLE_KEY
  );
}

function packageToFilename(pkg: PackageParam): string {
  switch (pkg) {
    case "essentials":
      return "REV3OWNER_EXEC_PDF.zip";
    case "complete":
      return "PROTECTED_PDF_COMPLETE.zip";
  }
}

export async function GET({ request, locals }: { request: Request; locals: unknown }) {
  const url = new URL(request.url);
  const pkg = url.searchParams.get("package");

  if (pkg !== "essentials" && pkg !== "complete") {
    return json(
      {
        error: "Invalid package. Use ?package=essentials or ?package=complete",
      },
      { status: 400 },
    );
  }

  const serviceRoleKey = getServiceRoleKey(locals);
  if (!serviceRoleKey) {
    return json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY runtime env var" },
      { status: 500 },
    );
  }

  const filename = packageToFilename(pkg);
  const expiresIn = 60 * 10; // 10 minutes

  const signRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}/${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    },
  );

  const signText = await signRes.text();
  if (!signRes.ok) {
    return json(
      {
        error: "Failed to sign download URL",
        status: signRes.status,
        details: signText,
      },
      { status: 502 },
    );
  }

  let signJson: any;
  try {
    signJson = JSON.parse(signText);
  } catch {
    return json(
      { error: "Unexpected response from Supabase Storage", details: signText },
      { status: 502 },
    );
  }

  const signedPath = signJson?.signedURL;
  if (typeof signedPath !== "string" || !signedPath.startsWith("/")) {
    return json(
      { error: "Supabase Storage did not return a signedURL", details: signJson },
      { status: 502 },
    );
  }

  return json({
    package: pkg,
    filename,
    expiresIn,
    url: `${SUPABASE_URL}${signedPath}`,
  });
}

