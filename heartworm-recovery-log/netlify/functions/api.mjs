import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async (req) => {
  const pass = Netlify.env.get("PASSCODE");
  if (!pass) return json({ error: "Server passcode not set" }, 500);
  if (req.headers.get("x-passcode") !== pass) return json({ error: "Wrong passcode" }, 401);

  const store = getStore({ name: "recovery-log", consistency: "strong" });
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  if (req.method === "GET" && parts.length === 0) {
    const settings = (await store.get("settings", { type: "json" })) || null;
    const { blobs } = await store.list({ prefix: "days/" });
    const days = {};
    await Promise.all(blobs.map(async (b) => { days[b.key.slice(5)] = await store.get(b.key, { type: "json" }); }));
    return json({ settings, days });
  }

  if (req.method === "PUT") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    if (!body || typeof body !== "object" || JSON.stringify(body).length > 50000) return json({ error: "Bad body" }, 400);
    if (parts[0] === "settings" && parts.length === 1) { await store.setJSON("settings", body); return json({ ok: true }); }
    if (parts[0] === "day" && parts.length === 2 && DATE.test(parts[1])) {
      await store.setJSON("days/" + parts[1], { ...body, updatedAt: Date.now() });
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
};

export const config = { path: ["/api", "/api/*"] };
