const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

const { get, run } = require('../db.js');

/**
 * Normaliza o telefone para formato E.164 (+55...)
 */
function formatE164(phone) {
  let cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned.startsWith('55') && cleaned.length >= 10) {
    cleaned = '55' + cleaned;
  }
  return '+' + cleaned;
}

/**
 * Dispara uma chamada telefônica de voz com IA pelo Dialog DDM Gateway
 *
 * @param {object} lead - O lead contendo telefone, nome e dados complementares
 * @returns {Promise<{success: boolean, log: string, callId?: string}>}
 */
async function makeDialDdmCall(lead) {
  const baseUrl = (process.env.DIALDDM_BASE_URL || process.env.VAPI_BASE_URL || 'https://dialddm.grupoddm.ia.br/v1').replace(/\/+$/, '');
  const apiKey = process.env.DIALDDM_API_KEY || process.env.VAPI_API_KEY || 'dialddm_live_key';
  const defaultAssistantId = process.env.DIALDDM_DEFAULT_ASSISTANT_ID || process.env.DEFAULT_ASSISTANT_ID || '11';
  const defaultPhoneNumberId = process.env.DIALDDM_PHONE_NUMBER_ID || 'oktor_sip_500ch';
  const maxConcurrency = parseInt(process.env.DIALDDM_MAX_CONCURRENCY || '20', 10);

  // Buscar configurações da campanha
  let campaignAssistantId = null;
  let campaignPhoneNumberId = null;
  try {
    const campaign = get('SELECT vapi_assistant_id, vapi_phone_number_id FROM campaigns WHERE id = ?', [lead.campaign_id]);
    campaignAssistantId = campaign?.vapi_assistant_id;
    campaignPhoneNumberId = campaign?.vapi_phone_number_id;
  } catch (err) {
    console.error('[DIAL DDM] Erro ao consultar campanha no banco:', err.message);
  }

  const finalAssistantId = campaignAssistantId || defaultAssistantId;
  const finalPhoneNumberId = campaignPhoneNumberId || defaultPhoneNumberId;

  // Modo de teste opcional
  const targetPhone = process.env.TEST_PHONE || lead.phone;
  if (process.env.TEST_PHONE) {
    console.log(`[DIAL DDM - MODO TESTE] Redirecionando chamada do Lead #${lead.id} (${lead.phone}) para o número de teste: ${targetPhone}`);
  }

  const phoneE164 = formatE164(targetPhone);

  // Extrair nome amigável
  const rawName = (lead.name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/TESTE PROD/gi, '')
    .trim() || lead.name || 'Cliente';

  // 1. Extração inicial do nome da planilha
  const words = rawName.split(/\s+/).filter(Boolean);
  let firstName = words[0] ? (words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()) : 'Cliente';
  const preps = ['de', 'da', 'do', 'dos', 'das'];
  let wordCount = 2;
  if (words.length > 2 && preps.includes(words[1].toLowerCase())) {
    wordCount = 3;
  }
  const selectedWords = words.slice(0, Math.min(wordCount, words.length));
  let shortName = selectedWords.map((w, idx) => {
    const lower = w.toLowerCase();
    if (idx > 0 && preps.includes(lower)) return lower;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ') || 'Cliente';
  let fullName = lead.name || shortName;
  let debtValue = lead.debt_value ? String(lead.debt_value) : '';
  let discountValue = '';
  let hasDiscount = false;

  // 2. Pré-consulta na API da Vero com o CPF antes de discar para garantir dados 100% atualizados
  if (lead.cpf) {
    try {
      const veroAcordo = require('./veroAcordo.js');
      console.log(`[DIAL DDM PRE-CHECK] Consultando API Vero para o CPF ${lead.cpf} (Lead #${lead.id})...`);
      const checkData = await veroAcordo.checkCliente(lead.cpf);

      if (checkData && checkData.cliente) {
        if (checkData.cliente.primeiro_nome) {
          const apiFirst = String(checkData.cliente.primeiro_nome).trim();
          firstName = apiFirst.charAt(0).toUpperCase() + apiFirst.slice(1).toLowerCase();
        }
        if (checkData.cliente.nome) {
          fullName = String(checkData.cliente.nome).trim();
          shortName = firstName;
        }
        if (Array.isArray(checkData.cliente.contratos) && checkData.cliente.contratos.length > 0) {
          const mainContract = checkData.cliente.contratos[0];
          if (mainContract.valor_total) {
            debtValue = String(mainContract.valor_total).replace(/\s/g, '');
          }
        }

        // Atualizar o banco de dados com os dados oficiais retornados pela API
        try {
          const numValue = parseFloat(debtValue.replace(/\./g, '').replace(',', '.')) || null;
          run(
            `UPDATE leads SET debt_value = COALESCE(?, debt_value), name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [numValue, fullName, lead.id]
          );
        } catch (dbErr) {}

        console.log(`[DIAL DDM PRE-CHECK SUCESSO] Lead #${lead.id} atualizado: Nome="${firstName}", Débito=R$ ${debtValue}`);
      }

      // Tenta simulação com desconto prévia
      try {
        const simData = await veroAcordo.simularAVista(lead.cpf);
        if (simData && !simData.error && (simData.valor_com_desconto || simData.valor_desconto)) {
          discountValue = String(simData.valor_com_desconto || simData.valor_desconto).replace(/\s/g, '');
          hasDiscount = true;
          console.log(`[DIAL DDM PRE-CHECK SUCESSO] Desconto disponível para Lead #${lead.id}: R$ ${discountValue}`);
        }
      } catch (simErr) {}

    } catch (apiErr) {
      console.warn(`[DIAL DDM PRE-CHECK WARN] Falha na pré-consulta do CPF ${lead.cpf}: ${apiErr.message}`);
    }
  }

  const appBaseUrl = process.env.APP_BASE_URL || 'https://veroacordo.grupoddm.ia.br';
  const webhookUrl = `${appBaseUrl}/api/vapi-webhook`;

  // Variáveis dinâmicas para o prompt da IA do Dialog DDM (já com débito e nome oficiais da API da Vero)
  const variableValues = {
    nome: shortName,
    nome_cliente: shortName,
    primeiro_nome: firstName,
    first_name: firstName,
    nome_completo: fullName,
    telefone: lead.phone || '',
    cpf: lead.cpf || '',
    email: lead.email || '',
    valor: debtValue || '0,00',
    valor_atualizado: debtValue || '0,00',
    valor_original: debtValue || '0,00',
    valor_com_desconto: discountValue || debtValue || '0,00',
    tem_desconto: hasDiscount ? 'sim' : 'nao'
  };

  if (lead.due_date) variableValues.vencimento = String(lead.due_date);
  if (lead.barcode) variableValues.codigo_barras = String(lead.barcode);

  const payload = {
    assistantId: String(finalAssistantId),
    phoneNumberId: String(finalPhoneNumberId),
    customer: {
      number: phoneE164,
      name: shortName
    },
    metadata: {
      lead_id: lead.id,
      campaign_id: lead.campaign_id
    },
    serverUrl: webhookUrl,
    maxConcurrency: maxConcurrency,
    assistantOverrides: {
      variableValues: variableValues
    }
  };

  try {
    console.log(`[DIAL DDM] Disparando chamada para ${phoneE164} | AssistantId: ${finalAssistantId} | PhoneNumberId: ${finalPhoneNumberId}`);

    const callUrl = `${baseUrl}/call/phone`;
    const response = await fetch(callUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
        'X-Max-Concurrency': String(maxConcurrency)
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { message: responseText };
    }

    if (!response.ok || (!data.id && !data.callId)) {
      const errMsg = data.message || data.error || responseText || `HTTP ${response.status}`;
      console.error(`[DIAL DDM ERROR] Resposta de erro para Lead #${lead.id}: ${errMsg}`);
      return {
        success: false,
        log: `Erro Dialog DDM (${errMsg})`
      };
    }

    const callId = data.id || data.callId;
    console.log(`[DIAL DDM SUCCESS] Chamada criada com sucesso para Lead #${lead.id}. Call ID: ${callId}`);

    // Salvar call_id no banco
    run(
      `UPDATE leads SET call_id = ?, call_status = 'calling', call_log = 'Chamada originada via Dialog DDM', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [callId, lead.id]
    );

    return {
      success: true,
      callId,
      log: `Chamada originada com sucesso via Dialog DDM. ID: ${callId}`
    };
  } catch (error) {
    console.error(`[DIAL DDM EXCEPTION] Falha de conexão ao discar Lead #${lead.id}:`, error.message);
    return {
      success: false,
      log: `Exceção de rede Dialog DDM: ${error.message}`
    };
  }
}

/**
 * Consulta a telemetria de concorrência e capacidade de canais do Dialog DDM
 */
async function getDialDdmConcurrency() {
  const baseUrl = (process.env.DIALDDM_BASE_URL || process.env.VAPI_BASE_URL || 'https://dialddm.grupoddm.ia.br/v1').replace(/\/+$/, '');
  const apiKey = process.env.DIALDDM_API_KEY || process.env.VAPI_API_KEY || 'dialddm_live_key';

  try {
    const res = await fetch(`${baseUrl}/concurrency`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.error('[DIAL DDM CONCURRENCY ERROR]', err.message);
    return {
      provider: 'Dialog DDM Voice AI',
      active_channels: 0,
      max_channels: 500,
      available_channels: 500,
      error: err.message
    };
  }
}

/**
 * Recupera histórico e áudio gravado de uma chamada
 */
async function getDialDdmTranscript(callId) {
  const baseUrl = (process.env.DIALDDM_BASE_URL || process.env.VAPI_BASE_URL || 'https://dialddm.grupoddm.ia.br/v1').replace(/\/+$/, '');
  const apiKey = process.env.DIALDDM_API_KEY || process.env.VAPI_API_KEY || 'dialddm_live_key';

  try {
    const res = await fetch(`${baseUrl}/call/${callId}/transcript`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`[DIAL DDM TRANSCRIPT ERROR] Call #${callId}:`, err.message);
    return null;
  }
}

/**
 * Lista todos os assistentes de voz cadastrados no Dialog DDM Gateway
 */
async function getDialDdmAssistants() {
  const baseUrl = (process.env.DIALDDM_BASE_URL || process.env.VAPI_BASE_URL || 'https://dialddm.grupoddm.ia.br/v1').replace(/\/+$/, '');
  const apiKey = process.env.DIALDDM_API_KEY || process.env.VAPI_API_KEY || 'dialddm_live_key';

  try {
    const res = await fetch(`${baseUrl}/assistants`, {
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey
      }
    });
    if (!res.ok) {
      const fallbackRes = await fetch(`${baseUrl}/assistant`, {
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey
        }
      });
      if (!fallbackRes.ok) throw new Error(`HTTP ${res.status}`);
      return await fallbackRes.json();
    }
    return await res.json();
  } catch (err) {
    console.error('[DIAL DDM ASSISTANTS ERROR]', err.message);
    return [
      { id: '6', name: 'Verô - Cobrança Recente', firstMessage: 'Olá, eu falo com {{nome_cliente}}, correto?' },
      { id: '5', name: 'Agente Homologador DDM - Testes 213', firstMessage: 'Olá, tudo bem?' }
    ];
  }
}

module.exports = {
  makeDialDdmCall,
  getDialDdmConcurrency,
  getDialDdmTranscript,
  getDialDdmAssistants
};
