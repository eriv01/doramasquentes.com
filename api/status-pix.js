/ ====================================================================
// /api/status-pix.js  -  consulta o status de um pagamento PIX
//
// O front faz polling: GET /api/status-pix?id=PAYMENT_ID
// Retorna { status } -> "pending" | "approved" | "rejected" | ...
//
// Variavel de ambiente: MP_ACCESS_TOKEN
// ====================================================================

module.exports = async function (req, res) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "missing_mp_token" });
    return;
  }

  const id = req.query && req.query.id ? String(req.query.id) : "";
  if (!id) {
    res.status(400).json({ error: "missing_id" });
    return;
  }

  try {
    const mpResp = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(id), {
      method: "GET",
      headers: { "Authorization": "Bearer " + token }
    });

    const data = await mpResp.json();

    if (!mpResp.ok) {
      console.log("status MP error", mpResp.status);
      res.status(502).json({ error: "mp_error" });
      return;
    }

    res.status(200).json({
      status: data.status,
      status_detail: data.status_detail || ""
    });

  } catch (err) {
    console.log("status-pix exception", err && err.message ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  }
};
