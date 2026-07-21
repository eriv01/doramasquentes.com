const PRODUTO = { nome: "pack hqs", preco: 17.00 };
const DESCONTO_PCT = 20;

const BUMP_NOMES = {
  bump1: "hestais18",
  bump2: "cenas proibidas"
};
const BUMP_TIERS = [7.90, 6.90];

function round2(v){ return Math.round(v * 100) / 100; }

// valida CPF (mesma logica do front, nunca confie so no cliente)
function cpfValido(v){
  var d = String(v || "").replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  var soma = 0, i;
  for (i = 0; i < 9; i++) soma += parseInt(d[i], 10) * (10 - i);
  var r1 = (soma * 10) % 11; if (r1 === 10) r1 = 0;
  if (r1 !== parseInt(d[9], 10)) return false;
  soma = 0;
  for (i = 0; i < 10; i++) soma += parseInt(d[i], 10) * (11 - i);
  var r2 = (soma * 10) % 11; if (r2 === 10) r2 = 0;
  if (r2 !== parseInt(d[10], 10)) return false;
  return true;
}

function unitBump(qtd){
  if (qtd <= 0) return 0;
  const idx = Math.min(qtd, BUMP_TIERS.length) - 1;
  return BUMP_TIERS[idx];
}

function calcularTotal(comDesconto, bumpsIds){
  let total = PRODUTO.preco;
  if (comDesconto) total = total * (1 - DESCONTO_PCT / 100);

  const validos = (bumpsIds || []).filter(function(id){ return BUMP_NOMES[id]; });
  const qtd = validos.length;
  const unit = unitBump(qtd);
  total += unit * qtd;

  const itens = [PRODUTO.nome].concat(validos.map(function(id){ return BUMP_NOMES[id]; }));
  return { total: round2(total), descricao: itens.join(" + ") };
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "missing_mp_token" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const nome    = String(body.nome || "Cliente").trim();
    const email   = String(body.email || "").trim();
    const cpf     = String(body.cpf || "").replace(/\D/g, "");
    const desconto = body.desconto === true;
    const bumps   = Array.isArray(body.bumps) ? body.bumps : [];

    if (!cpfValido(cpf)) {
      res.status(400).json({ error: "cpf_invalido" });
      return;
    }

    const partes = nome.split(" ");
    const first = partes[0] || "Cliente";
    const last  = partes.length > 1 ? partes.slice(1).join(" ") : "Comprador";

    const calc = calcularTotal(desconto, bumps);

    const payload = {
      transaction_amount: calc.total,
      description: calc.descricao,
      payment_method_id: "pix",
      payer: {
        email: email || "comprador@exemplo.com",
        first_name: first,
        last_name: last,
        identification: {
          type: "CPF",
          number: cpf
        }
      }
    };

    const idem = "pix_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);

    const mpResp = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idem
      },
      body: JSON.stringify(payload)
    });

    const data = await mpResp.json();

    if (!mpResp.ok) {
      console.log("MP error status", mpResp.status, JSON.stringify(data));
      res.status(502).json({ error: "mp_error", detail: data && data.message ? data.message : "erro" });
      return;
    }

    const tx = data &&
      data.point_of_interaction &&
      data.point_of_interaction.transaction_data
        ? data.point_of_interaction.transaction_data : {};

    res.status(200).json({
      payment_id: data.id,
      status: data.status,
      valor: calc.total,
      qr_code: tx.qr_code || "",
      qr_code_base64: tx.qr_code_base64 || "",
      ticket_url: tx.ticket_url || ""
    });

  } catch (err) {
    console.log("criar-pix exception", err && err.message ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  }
};
