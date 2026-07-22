// /api/webhook-mp.js
// Recebe notificacoes do Mercado Pago e dispara Purchase no Meta via CAPI

const crypto = require("crypto");

function sha256(v) {
  return crypto.createHash("sha256").update(String(v)).digest("hex");
}

module.exports = async function (req, res) {
  // MP usa GET para validacao e POST para notificacoes
  if (req.method === "GET") {
    res.status(200).send("ok");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // MP envia type=payment e data.id com o ID do pagamento
    if (body.type !== "payment" || !body.data || !body.data.id) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const paymentId = body.data.id;
    const token = process.env.MP_ACCESS_TOKEN;

    if (!token) {
      res.status(500).json({ error: "missing_mp_token" });
      return;
    }

    // Consulta o status real do pagamento no MP
    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: { "Authorization": "Bearer " + token }
    });

    const data = await mpResp.json();

    if (!mpResp.ok) {
      console.log("webhook-mp: erro ao consultar pagamento", paymentId, mpResp.status);
      res.status(200).json({ ok: false });
      return;
    }

    // So dispara Purchase se realmente aprovado
    if (data.status !== "approved") {
      console.log("webhook-mp: status nao aprovado", data.status, paymentId);
      res.status(200).json({ ok: true, status: data.status });
      return;
    }

    // Monta dados do comprador para CAPI
    const payer = data.payer || {};
    const valor = typeof data.transaction_amount === "number" ? data.transaction_amount : 0;
    const email = payer.email || "";
    const cpf   = payer.identification && payer.identification.number ? payer.identification.number : "";
    const nome  = [payer.first_name || "", payer.last_name || ""].join(" ").trim();

    const pixelId = process.env.META_PIXEL_ID;
    const capiToken = process.env.META_CAPI_TOKEN;

    if (!pixelId || !capiToken) {
      console.log("webhook-mp: meta env ausente");
      res.status(200).json({ ok: false, reason: "missing_meta_env" });
      return;
    }

    const eventId = "purchase_webhook_" + paymentId;
    const userData = {
      client_ip_address: (req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
      client_user_agent: req.headers["user-agent"] || ""
    };

    if (email) userData.em = [sha256(email.trim().toLowerCase())];
    if (cpf)   userData.ph = [sha256(cpf.replace(/\D/g, ""))];
    if (nome)  userData.fn = [sha256(nome.split(" ")[0].toLowerCase())];

    const evento = {
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: "https://" + (req.headers.host || ""),
      user_data: userData,
      custom_data: {
        value: valor,
        currency: "BRL"
      }
    };

    const fbUrl = "https://graph.facebook.com/v19.0/" + pixelId + "/events?access_token=" + capiToken;
    const fbResp = await fetch(fbUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [evento] })
    });

    const fbData = await fbResp.json();

    if (!fbResp.ok) {
      console.log("webhook-mp: erro CAPI", fbResp.status, JSON.stringify(fbData));
      res.status(200).json({ ok: false });
      return;
    }

    console.log("webhook-mp: Purchase disparado", paymentId, valor);
    res.status(200).json({ ok: true, payment_id: paymentId, valor });

  } catch (err) {
    console.log("webhook-mp exception", err && err.message ? err.message : err);
    res.status(200).json({ ok: false }); // sempre 200 pro MP nao retentar
  }
};
