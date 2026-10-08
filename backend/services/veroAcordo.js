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

// Cache em memória para consultas recentes (TTL: 10 minutos)
const queryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCached(key) {
  const item = queryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  queryCache.set(key, { data, timestamp: Date.now() });
}

const https = require('https');
const http = require('http');

/**
 * Cliente HTTP/HTTPS resiliente para a API Vero (evita Connect Timeout do Undici/Node Fetch em servidores lentos)
 */
function sendVeroHttpRequest(targetUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request(
        targetUrl,
        {
          method: 'GET',
          rejectUnauthorized: false,
          headers: {
            'Authorization': getAuthHeader(),
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VeroAcordo/1.0'
          },
          timeout: 30000
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              status: res.statusCode,
              text: () => Promise.resolve(data)
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout de 30s na conexão com API Vero'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 1. Check (dados do cliente e contratos)
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/check?cpf=89690770063"
 */
async function checkCliente(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const cacheKey = `check_${clean}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[VERO ACORDO API - CACHE HIT] Retornando check em 0ms para CPF: ${clean}`);
    return cached;
  }

  const url = `${BASE_URL}/check?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /check para CPF: ${clean}`);
  const startTime = Date.now();

  try {
    const res = await sendVeroHttpRequest(url);
    const duration = Date.now() - startTime;
    console.log(`[VERO ACORDO API] /check respondeu em ${duration}ms para CPF: ${clean} (Status HTTP: ${res.status})`);

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = { status: res.status, raw: text };
    }

    if (res.ok) {
      setCached(cacheKey, parsed);
    }
    return parsed;
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /check após ${Date.now() - startTime}ms:`, err.message);
    throw err;
  }
}

/**
 * 2. Simulação à vista
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/simulacao?cpf=89690770063"
 */
async function simularAVista(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const cacheKey = `simulacao_vista_${clean}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[VERO ACORDO API - CACHE HIT] Retornando simulacao à vista em 0ms para CPF: ${clean}`);
    return cached;
  }

  const url = `${BASE_URL}/simulacao?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /simulacao para CPF: ${clean}`);
  const startTime = Date.now();

  try {
    const res = await sendVeroHttpRequest(url);
    const duration = Date.now() - startTime;
    console.log(`[VERO ACORDO API] /simulacao respondeu em ${duration}ms para CPF: ${clean} (Status HTTP: ${res.status})`);

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = { status: res.status, raw: text };
    }

    if (res.ok) {
      setCached(cacheKey, parsed);
    }
    return parsed;
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /simulacao após ${Date.now() - startTime}ms:`, err.message);
    throw err;
  }
}

/**
 * 3. Simulações (1x a 12x)
 * curl -i -u "USUARIO:SENHA" "https://vero2.meuacordofacil.com.br/api/cliente/simulacoes?cpf=89690770063"
 */
async function simularParcelas(cpf) {
  const clean = cleanCpf(cpf);
  if (!clean) throw new Error('CPF é obrigatório.');

  const cacheKey = `simulacao_parcelas_${clean}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[VERO ACORDO API - CACHE HIT] Retornando simulacoes parceladas em 0ms para CPF: ${clean}`);
    return cached;
  }

  const url = `${BASE_URL}/simulacoes?cpf=${clean}`;
  console.log(`[VERO ACORDO API] GET /simulacoes para CPF: ${clean}`);
  const startTime = Date.now();

  try {
    const res = await sendVeroHttpRequest(url);
    const duration = Date.now() - startTime;
    console.log(`[VERO ACORDO API] /simulacoes respondeu em ${duration}ms para CPF: ${clean} (Status HTTP: ${res.status})`);

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = { status: res.status, raw: text };
    }

    if (res.ok) {
      setCached(cacheKey, parsed);
    }
    return parsed;
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /simulacoes após ${Date.now() - startTime}ms:`, err.message);
    throw err;
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
  console.log(`[VERO ACORDO API] GET /conclusao para CPF: ${clean}`);

  try {
    const res = await sendVeroHttpRequest(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { status: res.status, raw: text };
    }
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /conclusao:`, err.message);
    throw err;
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

  try {
    const res = await sendVeroHttpRequest(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { status: res.status, raw: text };
    }
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /conclusao-parcela:`, err.message);
    throw err;
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

  try {
    const res = await sendVeroHttpRequest(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { status: res.status, raw: text };
    }
  } catch (err) {
    console.error(`[VERO ACORDO API ERROR] Falha no /acordo:`, err.message);
    throw err;
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
