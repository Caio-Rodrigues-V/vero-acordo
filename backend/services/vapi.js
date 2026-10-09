const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

const { get, run, all } = require('../db.js');
const { SYSTEM_PROMPT_TEMPLATE, FIRST_MESSAGE_TEMPLATE } = require('../config/agentPrompt.js');

/**
 * Formata o valor de débito para Real (R$)
 */
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Normaliza o telefone para formato E.164 (ex: +5511999998888)
 */
function formatE164(phone) {
  let cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned.startsWith('55') && cleaned.length >= 10) {
    cleaned = '55' + cleaned;
  }
  return '+' + cleaned;
}

/**
 * Converte valor float em BRL para extenso em Português (Regra rígida de voz da Verô)
 */
function numberToWordsBRL(amount) {
  const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const teens = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const tens = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

  function convertGroup(n) {
    if (n === 100) return "cem";
    let words = [];
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0) words.push(hundreds[h]);
    if (t === 1) {
      words.push(teens[u]);
    } else {
      if (t > 0) words.push(tens[t]);
      if (u > 0) words.push(units[u]);
    }
    return words.filter(Boolean).join(" e ");
  }

  const parts = parseFloat(amount).toFixed(2).split(".");
  const reais = parseInt(parts[0]);
  const centavos = parseInt(parts[1]);

  let reaisStr = "";
  if (reais === 0) {
    reaisStr = "zero reais";
  } else if (reais === 1) {
    reaisStr = "um real";
  } else {
    const thousands = Math.floor(reais / 1000);
    const remainder = reais % 1000;
    let partsStr = [];
    if (thousands > 0) {
      partsStr.push(thousands === 1 ? "mil" : convertGroup(thousands) + " mil");
    }
    if (remainder > 0) {
      partsStr.push(convertGroup(remainder));
    }
    reaisStr = partsStr.join(" e ") + " reais";
  }

  let centavosStr = "";
  if (centavos > 0) {
    if (centavos === 1) {
      centavosStr = "um centavo";
    } else {
      centavosStr = convertGroup(centavos) + " centavos";
    }
  }

  if (reaisStr && centavosStr) {
    return `${reaisStr} e ${centavosStr}`;
  }
  return reaisStr || centavosStr;
}

/**
 * Converte quantidade de dias/faturas por extenso (Regra rígida de voz da Verô)
 */
function daysToWords(days) {
  const units = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const teens = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const tens = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

  function convertGroup(n) {
    if (n === 100) return "cem";
    let words = [];
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0) words.push(hundreds[h]);
    if (t === 1) {
      words.push(teens[u]);
    } else {
      if (t > 0) words.push(tens[t]);
      if (u > 0) words.push(units[u]);
    }
    return words.filter(Boolean).join(" e ");
  }

  if (days <= 9) return units[days];
  return convertGroup(days);
}

/**
 * Dispara uma chamada de voz conversacional real usando a VAPI.ai
 * 
 * @param {object} lead - O lead contendo telefone, nome, valor e vencimento
 * @returns {Promise<{success: boolean, log: string, callId?: string}>}
 */
async function makeVapiCall(lead) {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  let phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID || '3fd74b77-c837-4c33-a6b2-20fd915c5a81'; // OKTOR SIP NOVA 01-09 (+5521983137367)

  // Buscar o assistente e a linha/tronco telefônico selecionados nesta campanha no banco
  let campaignAssistantId = null;
  let campaignPhoneNumberId = null;
  try {
    const campaign = get('SELECT vapi_assistant_id, vapi_phone_number_id FROM campaigns WHERE id = ?', [lead.campaign_id]);
    campaignAssistantId = campaign?.vapi_assistant_id;
    campaignPhoneNumberId = campaign?.vapi_phone_number_id;
  } catch (err) {
    console.error('[VAPI] Erro ao buscar dados da campanha no banco:', err.message);
  }

  let finalAssistantId = campaignAssistantId || assistantId;
  let finalPhoneNumberId = campaignPhoneNumberId || phoneNumberId;

  const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  if (!isUuid(finalAssistantId) && apiKey) {
    try {
      const astRes = await fetch('https://api.vapi.ai/assistant', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (astRes.ok) {
        const asts = await astRes.json();
        if (asts.length > 0 && asts[0].id) {
          finalAssistantId = asts[0].id;
          console.log(`[VAPI RESOLVE] Usando assistente Vapi automático: ${finalAssistantId} (${asts[0].name})`);
        }
      }
    } catch (e) {}
  }

  if (!isUuid(finalPhoneNumberId) && apiKey) {
    try {
      const pnRes = await fetch('https://api.vapi.ai/phone-number', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (pnRes.ok) {
        const pns = await pnRes.json();
        if (pns.length > 0 && pns[0].id) {
          finalPhoneNumberId = pns[0].id;
          console.log(`[VAPI RESOLVE] Usando linha telefônica Vapi automática: ${finalPhoneNumberId}`);
        }
      }
    } catch (e) {}
  }

  // Implementar Modo de Teste: Redireciona para o número de teste se TEST_PHONE estiver no .env
  const targetPhone = process.env.TEST_PHONE || lead.phone;
  if (process.env.TEST_PHONE) {
    console.log(`[VAPI - MODO TESTE] Redirecionando chamada do Lead #${lead.id} (${lead.phone}) para o número de teste: ${targetPhone}`);
  }

  const phoneE164 = formatE164(targetPhone);
  
  // Compilar as variáveis da Verô conforme as regras rígidas de voz
  const valorFaturaText = numberToWordsBRL(lead.debt_value);
  const statusInternetText = lead.status_internet || '';
  const diasAtrasoText = daysToWords(lead.dias_atraso || 0) + ' dias';

  // Calcular quantidade de faturas deste cliente na campanha (número de ocorrências deste fone)
  let numeroFaturas = 1;
  try {
    const countResult = get('SELECT COUNT(id) as count FROM leads WHERE campaign_id = ? AND phone = ?', [lead.campaign_id, lead.phone]);
    if (countResult && countResult.count > 0) {
      numeroFaturas = countResult.count;
    }
  } catch (err) {
    console.error('[VAPI] Erro ao calcular número de faturas do lead:', err.message);
  }

  const faturasWords = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
  const faturasText = numeroFaturas <= 10 ? faturasWords[numeroFaturas] : String(numeroFaturas);

  // Determinar se o telefone é fixo ou móvel
  const cleanNum = lead.phone.replace(/\D/g, '');
  let isMobile = false;
  if (cleanNum.startsWith('55')) {
    isMobile = cleanNum.length === 13 && cleanNum.charAt(4) === '9';
  } else {
    isMobile = cleanNum.length === 11 && cleanNum.charAt(2) === '9';
  }
  const tipoTelefoneText = isMobile ? 'móvel' : 'fixo';

  // Compilar os prompts substituindo as variáveis da Verô
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{nome_cliente\}\}/g, lead.name)
    .replace(/\{\{valor_fatura\}\}/g, valorFaturaText)
    .replace(/\{\{dias_atraso\}\}/g, diasAtrasoText)
    .replace(/\{\{status_internet\}\}/g, statusInternetText)
    .replace(/\{\{numero_faturas\}\}/g, faturasText)
    .replace(/\{\{tipo_telefone\}\}/g, tipoTelefoneText);

  const firstMessage = FIRST_MESSAGE_TEMPLATE
    .replace(/\{\{nome_cliente\}\}/g, lead.name);

  // Se faltar chave da API, ID do assistente ou linha SIP
  if (!apiKey || !finalAssistantId || !finalPhoneNumberId) {
    const isMockAllowed = process.env.MOCK_CALLS === 'true' || process.env.NODE_ENV === 'development';
    if (isMockAllowed) {
      console.log(`[VAPI MOCK] Ligando para ${phoneE164} usando Assistente: ${finalAssistantId || 'Inline-Vero'}`);
      console.log(`[VAPI MOCK] Prompt Inicial: "${firstMessage}"`);
      return {
        success: true,
        log: `[SIMULATED VAPI] Ligação efetuada em modo de teste local para assistente ${finalAssistantId || 'Verô'}.`
      };
    } else {
      const missingKeys = [];
      if (!apiKey) missingKeys.push('VAPI_API_KEY');
      if (!finalAssistantId) missingKeys.push('VAPI_ASSISTANT_ID/vapi_assistant_id');
      if (!finalPhoneNumberId) missingKeys.push('VAPI_PHONE_NUMBER_ID/vapi_phone_number_id');
      const errLog = `[VAPI ERRO PROD] Falha de configuração: Variáveis faltando (${missingKeys.join(', ')})`;
      console.error(errLog);
      return {
        success: false,
        log: errLog
      };
    }
  }

  const baseUrl = process.env.APP_BASE_URL || 'https://verolembrete.grupoddm.ia.br';
  const webhookUrl = `${baseUrl}/api/vapi-webhook`;

  const rawName = (lead.name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/TESTE PROD/gi, '')
    .trim() || lead.name || 'Cliente';

  // Extrair primeiro e segundo nome (ex: "JONATAS BERNARDO NUNES" -> "Jonatas Bernardo", "DENISIANE DA CRUZ" -> "Denisiane da Cruz")
  const words = rawName.split(/\s+/).filter(Boolean);
  const preps = ['de', 'da', 'do', 'dos', 'das'];
  let wordCount = 2;
  if (words.length > 2 && preps.includes(words[1].toLowerCase())) {
    wordCount = 3;
  }
  const selectedWords = words.slice(0, Math.min(wordCount, words.length));
  const shortName = selectedWords.map((w, idx) => {
    const lower = w.toLowerCase();
    if (idx > 0 && preps.includes(lower)) return lower;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ') || 'Cliente';

  // Montar o corpo da requisição incluindo serverUrl em assistantOverrides para garantia do Webhook VAPI
  const body = {
    assistantId: finalAssistantId,
    phoneNumberId: finalPhoneNumberId,
    customer: {
      number: phoneE164,
      name: shortName
    },
    metadata: {
      lead_id: lead.id,
      campaign_id: lead.campaign_id
    },
    assistantOverrides: {
      firstMessage: `Olá, eu falo com ${shortName}, correto?`,
      firstMessageMode: 'assistant-speaks-first',
      serverUrl: webhookUrl,
      artifactPlan: {
        recordingEnabled: true
      },
      voicemailDetection: {
        provider: 'vapi'
      },
      stopSpeakingPlan: {
        numWords: 3
      },
      variableValues: {
        NOME_DEV: shortName,
        nome_cliente: shortName,
        VAL_NOMINAL: valorFaturaText,
        valor_fatura: valorFaturaText,
        dias_atraso: diasAtrasoText,
        status_internet: statusInternetText,
        numero_faturas: faturasText,
        tipo_telefone: tipoTelefoneText
      }
    }
  };

  try {
    console.log(`[VAPI CALL] Disparando chamada para ${phoneE164} | AssistantId: ${finalAssistantId} | PhoneNumberId: ${finalPhoneNumberId} | Webhook: ${webhookUrl}`);

    // Disparar chamada com Retry para HTTP 429 (Rate limit)
    let response;
    let textResponse;
    let data;

    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch('https://api.vapi.ai/call', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      textResponse = await response.text();
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        data = { message: textResponse || `HTTP ${response.status}` };
      }

      if (response && response.status === 429) {
        console.log(`[VAPI CALL] HTTP 429 (Rate limit) para Lead #${lead.id} na tentativa ${attempt}. Aguardando ${2 * attempt}s...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      break;
    }

    if (!response.ok || !data.id) {
      const errMessage = data.message || data.error || (data.message?.message) || JSON.stringify(data);
      const fullErrLog = `HTTP ${response.status}: ${errMessage}`;
      console.error(`[VAPI ERROR] Resposta de erro da VAPI para Lead #${lead.id}: ${fullErrLog}`);
      return {
        success: false,
        log: `Erro VAPI API (${fullErrLog})`
      };
    }

    // Salvar o call_id da VAPI diretamente no lead para auditoria e callbacks
    try {
      const { run: runDb } = require('../db.js');
      runDb('UPDATE leads SET call_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [data.id, lead.id]);
    } catch (e) {
      console.error('[VAPI DB UPDATE WARN]', e.message);
    }

    return {
      success: true,
      callId: data.id,
      log: `Chamada VAPI iniciada com sucesso. ID: ${data.id}`
    };

  } catch (error) {
    console.error(`[VAPI ERROR] Exceção ao disparar chamada para o lead #${lead.id}:`, error.message);
    return {
      success: false,
      log: `Exceção VAPI: ${error.message}`
    };
  }
}

/**
 * Consulta a API REST da Vapi (GET /call/{callId}) para buscar detalhes, transcrição e áudio gravado
 */
async function fetchVapiCallDetails(callId) {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error('[VAPI FETCH WARN] VAPI_API_KEY não está configurada no process.env!');
    return null;
  }
  if (!callId) return null;

  try {
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[VAPI FETCH ERROR] Call #${callId} HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();

    const recordingUrl = 
      (typeof data.recordingUrl === 'string' ? data.recordingUrl : null) || 
      (typeof data.stereoRecordingUrl === 'string' ? data.stereoRecordingUrl : null) || 
      (typeof data.monoRecordingUrl === 'string' ? data.monoRecordingUrl : null) || 
      (typeof data.recording === 'string' ? data.recording : null) ||
      (typeof data.recording?.url === 'string' ? data.recording.url : null) ||
      (typeof data.artifactUrl === 'string' ? data.artifactUrl : null) ||
      (typeof data.artifact?.recordingUrl === 'string' ? data.artifact.recordingUrl : null) || 
      (typeof data.artifact?.stereoRecordingUrl === 'string' ? data.artifact.stereoRecordingUrl : null) || 
      (typeof data.artifact?.monoRecordingUrl === 'string' ? data.artifact.monoRecordingUrl : null) ||
      (typeof data.artifact?.recording === 'string' ? data.artifact.recording : null) ||
      (typeof data.artifact?.recording?.url === 'string' ? data.artifact.recording.url : null) ||
      (typeof data.artifact?.artifactUrl === 'string' ? data.artifact.artifactUrl : null) ||
      (typeof data.callAnalysis?.recordingUrl === 'string' ? data.callAnalysis.recordingUrl : null) ||
      null;

    let transcript = data.transcript || data.artifact?.transcript || data.analysis?.transcript || null;
    
    const msgList = data.artifact?.messages || data.messages || data.artifact?.messagesOpenAIFormatted;
    if (!transcript && Array.isArray(msgList)) {
      transcript = msgList
        .filter(m => m && m.role !== 'system' && (m.message || m.content || m.text))
        .map(m => {
          const sender = m.role === 'assistant' || m.role === 'bot' ? 'Vero' : 'Cliente';
          const text = m.message || m.content || m.text || '';
          return `${sender}: ${text}`;
        })
        .filter(str => !str.endsWith(': '))
        .join('\n');
    }

    console.log(`[VAPI FETCH OK] Call #${callId} -> recordingUrl: ${recordingUrl ? 'ENCONTRADO' : 'NÃO ENCONTRADO'} | transcript: ${transcript ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}`);

    return {
      recordingUrl,
      transcript,
      summary: data.summary || data.analysis?.summary || data.artifact?.summary || null,
      endedReason: data.endedReason || null
    };
  } catch (err) {
    console.error(`[VAPI FETCH CALL DETAILS ERROR] Call #${callId}:`, err.message);
    return null;
  }
}

/**
 * Busca no banco todos os leads que possuem call_id mas ainda estão sem recording_url ou transcript,
 * e consulta a API REST da Vapi para atualizar o banco em tempo real.
 */
async function syncMissingVapiRecordings(campaignId = null) {
  const { all, run } = require('../db.js');
  let query = `SELECT id, call_id FROM leads WHERE call_id IS NOT NULL AND call_id != '' AND (recording_url IS NULL OR transcript IS NULL OR transcript = '')`;
  const params = [];

  if (campaignId) {
    query += ` AND campaign_id = ?`;
    params.push(campaignId);
  }

  query += ` LIMIT 50`;

  const leadsMissingData = all(query, params);

  if (!leadsMissingData || leadsMissingData.length === 0) return;

  console.log(`[VAPI RECORDING SYNC] Sincronizando áudios e transcrições da API Vapi para ${leadsMissingData.length} leads...`);

  for (const lead of leadsMissingData) {
    const details = await fetchVapiCallDetails(lead.call_id);
    if (details) {
      if (details.recordingUrl || details.transcript) {
        run(
          `UPDATE leads SET 
            recording_url = COALESCE(?, recording_url), 
            transcript = COALESCE(?, transcript) 
           WHERE id = ?`,
          [details.recordingUrl, details.transcript, lead.id]
        );
      }
    }
  }
}

module.exports = { 
  makeVapiCall, 
  fetchVapiCallDetails, 
  syncMissingVapiRecordings,
  numberToWordsBRL
};
