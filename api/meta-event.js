// ====================================================================
// /api/meta-event.js  -  espelha eventos do Pixel via Conversions API
//
// O navegador dispara fbq(...) com um eventID, e chama este endpoint
// com o MESMO event_id. A Meta deduplica por (event_name + event_id),
// cobrindo iOS/Safari/bloqueadores que cortam o Pixel do navegador.
//
// Variaveis de ambiente (painel da Vercel):
//   META_PIXEL_ID   -> id do Pixel
//   META_CAPI_TOKEN -> token da Conversions API (Eventos > Configuracoes)
// ====================================================================

const crypto = require("crypto");

function sha256(v){
  return crypto.createHash("sha256").update(String(v)).digest("hex");
}
// normaliza e aplica hash conforme exigido pela Meta
function hashEmail(e){
  if (!e) return null;
  return sha256(String(e).trim().toLowerCase());
}
function hashPhone(p){
  if (!p) return null;
  let d = String(p).replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 11 && d[0] !== "5") d = "55" + d; // assume Brasil
  return sha256(d);
}
function hashName(n){
  if (!n) return null;
  return sha256(String(n).trim().toLowerCase());
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const pixelId = process.env.META_PIXEL_ID;
  const token   = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) {
    // nao quebra o checkout: so registra e responde ok
    console.log("meta-event missing env (pixel/token)");
    res.status(200).json({ ok: false, reason: "missing_env" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const user = body.user || {};

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
            || (req.socket && req.socket.remoteAddress) || "";
    const ua = req.headers["user-agent"] || "";

    const userData = {
      client_ip_address: ip,
      client_user_agent: ua
    };
    const em = hashEmail(user.email); if (em) userData.em = [em];
    const ph = hashPhone(user.phone); if (ph) userData.ph = [ph];
    const fn = hashName(user.nome);   if (fn) userData.fn = [fn];
    if (body.fbp) userData.fbp = body.fbp;
    if (body.fbc) userData.fbc = body.fbc;

    const evento = {
      event_name: body.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: body.event_id,
      action_source: "website",
      event_source_url: body.event_source_url || "",
      user_data: userData,
      custom_data: body.custom_data || {}
    };

    const url = "https://graph.facebook.com/v19.0/" + pixelId + "/events?access_token=" + token;

    const fbResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [evento] })
    });

    const data = await fbResp.json();
    if (!fbResp.ok) {
      console.log("CAPI error", fbResp.status, JSON.stringify(data));
      res.status(200).json({ ok: false }); // nunca quebra o front
      return;
    }

    res.status(200).json({ ok: true });

  } catch (err) {
    console.log("meta-event exception", err && err.message ? err.message : err);
    res.status(200).json({ ok: false });
  }
};
