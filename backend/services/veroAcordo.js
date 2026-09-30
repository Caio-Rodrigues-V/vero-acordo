const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const BASE_URL = (process.env.VERO_ACORDO_BASE_URL || 'https://vero2.meuacordofacil.com.br/api/cliente').replace(/\/+$/, '');
const USER = process.env.VERO_ACORDO_USER || '';
const PASS = process.env.VERO_ACORDO_PASS || '';

/**
 * Monta o header de autenticação Basic Auth
 */
function getAuthHeader() {
  const credentials = `${USER}:${PASS}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Limpa formato do CPF mantendo apenas dígitos numéricos
 */
function cleanCpf(cpf) {
  if (!cpf) return '';
  return String(cpf).replace(/\D/g, '');
}

/**
 * 1. Check (dados do cliente e contratos)
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/check?cpf=89690770063"
 */
async function checkCliente(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/check?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /check para CPF: ${clean}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

/**
 * 2. Simulação à vista
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/simulacao?cpf=89690770063"
 */
async function simularAVista(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/simulacao?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /simulacao para CPF: ${clean}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

/**
 * 3. Simulações (1x a 12x)
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/simulacoes?cpf=89690770063"
 */
async function simularParcelas(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/simulacoes?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /simulacoes para CPF: ${clean}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

/**
 * 4. Fechar acordo à vista
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/conclusao?cpf=89690770063"
 */
async function fecharAcordoAVista(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/conclusao?cpf=${clean}`;
  console.log(`[VERO ACORDO API] POST/GET /conclusao para CPF: ${clean}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

/**
 * 5. Fechar acordo parcelado
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/conclusao-parcela?cpf=89690770063&parcelas=3"
 */
async function fecharAcordoParcelado(cpf, parcelas = 1) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/conclusao-parcela?cpf=${clean}&parcelas=${encodeURIComponent(parcelas)}`;
  console.log(`[VERO ACORDO API] GET /conclusao-parcela para CPF: ${clean}, parcelas: ${parcelas}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

/**
 * 6. Consultar acordo
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/acordo?cpf=89690770063"
 */
async function consultarAcordo(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const url = `${BASE_URL}/acordo?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /acordo para CPF: ${clean}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, raw: text };
  }
}

module.exports = {
  checkCliente,
  simularAVista,
  simularParcelas,
  fecharAcordoAVista,
  fecharAcordoParcelado,
  consultarAcordo
};
