const dotenv = require('dotenv');
dotenv.config();

const MINHA_VERO_APP_LINKS = [
  'iPhone: https://apps.apple.com/br/app/minha-vero/id1500068558',
  'Android: https://play.google.com/store/apps/details?id=com.vero_mobile&pcampaignid=web_share'
].join('\n');

function buildPaymentMessage(lead, valorFormatado) {
  const cleanBarcode = String(lead.barcode || '').replace(/\D/g, '').trim();
  if (cleanBarcode) {
    return `${cleanBarcode}\nVero: fatura em aberto ${valorFormatado}.`;
  }
  return `Vero: obrigado por atender nosso contato. Em breve enviaremos mais informacoes sobre sua fatura.`;
}

function limitSmsMessage(text) {
  return String(text).slice(0, 160);
}

function formatBarcodeForBoleto(code) {
  const d = String(code || '').replace(/\D/g, '');
  if (d.length === 47) {
    return d.slice(0,5) + '.' + d.slice(5,10) + ' ' + d.slice(10,15) + '.' + d.slice(15,21) + ' ' + d.slice(21,26) + '.' + d.slice(26,32) + ' ' + d.slice(32,33) + ' ' + d.slice(33);
  }
  return String(code || '').trim();
}

function buildDdmShortMessage(lead, valorFormatado) {
  if (lead.barcode) {
    const formattedCode = formatBarcodeForBoleto(lead.barcode);
    return limitSmsMessage(`${formattedCode} Vero: fatura em aberto ${valorFormatado}.`);
  }
  return limitSmsMessage(`Vero: obrigado por atender nosso contato. Em breve enviaremos mais informacoes sobre sua fatura.`);
}

/**
 * Dispara a mensagem SMS diretamente usando a API da Unipix.
 * 
 * @param {object} lead - O objeto do lead
 * @returns {Promise<{success: boolean, log: string}>}
 */
async function triggerUnipixSms(lead) {
  const username = process.env.UNIPIX_USERNAME;
  const password = process.env.UNIPIX_PASSWORD;
  const centroCustoId = process.env.UNIPIX_CENTRO_CUSTO_ID || '123';
  const produtoId = process.env.UNIPIX_PRODUTO_ID || '34';
  const apiUrl = 'https://api-sms-cliente.unipix.com.br/v2/api/campanha/simples';

  // Implementar Modo de Teste: Redireciona para o número de teste se TEST_PHONE estiver no .env
  const targetPhone = process.env.TEST_PHONE || lead.phone;
  if (process.env.TEST_PHONE) {
    console.log(`[Unipix SMS - MODO TESTE] Redirecionando mensagem do Lead #${lead.id} (${lead.phone}) para o número de teste: ${targetPhone}`);
  }

  // Se o usuário/senha não estiver configurado no .env, roda no modo simulado (Mock)
  if (!username || !password) {
    console.log(`[Unipix SMS MOCK] Usuário/Senha não configurados. Simulando envio para ${targetPhone}`);
    return {
      success: true,
      log: `[SIMULATED Unipix SMS] Mensagem simulada enviada com sucesso para ${targetPhone}.`
    };
  }

  // Limpar telefone (apenas dígitos e com prefixo DDI 55)
  let cleanedPhone = String(targetPhone).replace(/\D/g, '');
  if (!cleanedPhone.startsWith('55') && cleanedPhone.length >= 10) {
    cleanedPhone = '55' + cleanedPhone;
  }

  // Se não houver código de barras, gera aviso para não tentar enviar SMS vazio
  if (!lead.barcode) {
    console.log(`[Unipix SMS] Lead #${lead.id} não possui linha digitável. Abortando envio.`);
    return {
      success: false,
      log: 'Cancelado: Lead não possui linha digitável.'
    };
  }

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.debt_value);
  
  // Mensagem padronizada da Vero para envio de boleto
  const messageText = buildPaymentMessage(lead, valorFormatado);

  try {
    console.log(`[Unipix SMS] Enviando mensagem para ${cleanedPhone}...`);
    
    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        centroCustoId: parseInt(centroCustoId, 10),
        envios: [
          {
            mensagemNumero: messageText,
            numero: cleanedPhone,
            smsClienteId: String(lead.id)
          }
        ],
        mensagemCampanha: "",
        nome: "Vero Cobrança",
        produtoId: parseInt(produtoId, 10),
        telefones: ""
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Erro API Unipix: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText);
    const smsId = data.smsEnvios && data.smsEnvios[0] ? data.smsEnvios[0].smsId : (data.id || 'N/A');

    console.log(`[Unipix SMS] Mensagem enviada com sucesso para ${cleanedPhone}. ID: ${smsId}`);
    return {
      success: true,
      log: `[Unipix SMS] Enviado com sucesso. ID: ${smsId}`
    };
  } catch (error) {
    console.error(`[Unipix SMS ERROR] Falha ao enviar para lead #${lead.id}:`, error.message);
    return {
      success: false,
      log: `[Unipix SMS] Falha no envio: ${error.message}`
    };
  }
}

/**
 * Envia um e-mail com o boleto/acordo usando a API da Locaweb SMTPlw.
 * 
 * @param {object} lead - O objeto do lead
 * @returns {Promise<{success: boolean, log: string}>}
 */
async function sendLocawebEmail(lead) {
  const token = process.env.LOCAWEB_TOKEN || '45790aba479f30ec65f106995d8e7424';
  const fromName = process.env.LOCAWEB_FROM_NAME || 'Vero Internet';
  const fromEmail = process.env.LOCAWEB_FROM || 'verointernet@grupoddm.com.br';
  const apiUrl = 'https://api.smtplw.com.br/v1/messages';

  // Se houver TEST_EMAIL no .env, redireciona o e-mail para o teste
  const targetEmail = process.env.TEST_EMAIL || lead.email;

  if (!targetEmail || !targetEmail.includes('@')) {
    return { success: false, log: 'Cancelado: Lead sem e-mail cadastrado.' };
  }

  if (process.env.TEST_EMAIL) {
    console.log(`[Locaweb Email - MODO TESTE] Redirecionando e-mail do Lead #${lead.id} (${lead.email || 'sem e-mail'}) para o e-mail de teste: ${targetEmail}`);
  }

  // Se não houver código de barras, gera aviso
  if (!lead.barcode) {
    console.log(`[Locaweb Email] Lead #${lead.id} não possui linha digitável. Abortando envio.`);
    return {
      success: false,
      log: 'Cancelado: Lead não possui linha digitável.'
    };
  }

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.debt_value);

  const baseUrl = process.env.APP_BASE_URL || 'https://verolembrete.grupoddm.ia.br';
  const logoUrl = `${baseUrl}/logo_vero.png`;

  // Template HTML adaptado para a Vero Internet
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FAF7F4;font-family:'Inter',Arial,sans-serif;color:#1F1F1F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF7F4;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#ffffff;padding:24px 32px;text-align:left;border-bottom:1px solid #FAF7F4;">
              <img src="${logoUrl}" alt="Vero Internet" height="42" style="display:block;">
            </td>
          </tr>
          <tr>
            <td style="padding:32px;font-size:15px;line-height:1.7;color:#1F1F1F;">
              <h2 style="color:#5b1f8f;font-family:'Poppins',Arial,sans-serif;margin:0 0 12px 0;font-size:22px;">Aviso de Fatura em Aberto</h2>
              <p style="margin:0 0 16px 0;">Prezado(a) <strong>${lead.name}</strong>,</p>
              <p style="margin:0 0 20px 0;">
                Confirmamos o seu contato com a nossa agente virtual referente à pendência com a <strong>Vero Internet</strong>. Conforme solicitado, segue o código de barras para pagamento da sua fatura:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F4;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;word-break:break-all;"><strong>Linha Digitável:</strong> ${lead.barcode}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Valor da Fatura:</strong> <span style="color:#5b1f8f;font-size:16px;font-weight:bold;">${valorFormatado}</span></td></tr>
                <tr><td style="padding:6px 0;"><strong>Vencimento Original:</strong> ${lead.due_date || ''}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Dias em Atraso:</strong> ${lead.dias_atraso || 0} dias</td></tr>
              </table>
              <div style="background:#FAF7F4;border-left:4px solid #5b1f8f;padding:20px;margin:24px 0;border-radius:6px;text-align:center;">
                <h3 style="margin:0 0 12px 0;font-family:'Poppins',Arial,sans-serif;color:#1F1F1F;font-size:15px;">Copie a Linha Digitável acima e utilize o aplicativo do seu banco para efetuar o pagamento.</h3>
              </div>
              <p style="margin:20px 0 0 0;font-size:14px;color:#475467;">
                Qualquer dúvida, nossa equipe está à disposição.<br>
                <strong>Equipe de Atendimento — Vero Internet</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    console.log(`[Locaweb Email] Enviando e-mail para ${targetEmail}...`);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: targetEmail,
        subject: `Fatura em Aberto — Vero Internet`,
        body: htmlBody,
        headers: {
          'content-type': 'text/html'
        }
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Erro API Locaweb: ${response.status} - ${responseText}`);
    }

    console.log(`[Locaweb Email] E-mail enviado com sucesso para ${targetEmail}. Resposta: ${responseText}`);
    return {
      success: true,
      log: `[Locaweb Email] Enviado com sucesso.`
    };
  } catch (error) {
    console.error(`[Locaweb Email ERROR] Falha ao enviar para lead #${lead.id}:`, error.message);
    return {
      success: false,
      log: `[Locaweb Email ERROR] Falha: ${error.message}`
    };
  }
}

/**
 * Dispara a mensagem Smart RCS usando a API da Smart RCS.
 * 
 * @param {object} lead - O objeto do lead
 * @returns {Promise<{success: boolean, log: string}>}
 */
async function triggerSmartRcs(lead) {
  const apiKey = process.env.SMART_RCS_API_KEY || '3EE7BE3E-FE44-4EFA-B0DA-6D85D096BB63';
  const apiUrl = process.env.SMART_RCS_API_URL || 'https://developer.smartrcs.com.br/api/Message/text';
  const senderAgent = process.env.SMART_RCS_SENDER || 'rcs_grupoddm';

  // Implementar Modo de Teste: Redireciona para o número de teste se TEST_PHONE estiver no .env
  const targetPhone = process.env.TEST_PHONE || lead.phone;
  if (process.env.TEST_PHONE) {
    console.log(`[SMS - MODO TESTE] Redirecionando mensagem do Lead #${lead.id} (${lead.phone}) para o número de teste: ${targetPhone}`);
  }

  // Limpar telefone (apenas dígitos e com prefixo DDI 55)
  let cleanedPhone = String(targetPhone).replace(/\D/g, '');
  if (!cleanedPhone.startsWith('55') && cleanedPhone.length >= 10) {
    cleanedPhone = '55' + cleanedPhone;
  }

  if (!lead.barcode) {
    console.log(`[SMS] Lead #${lead.id} não possui linha digitável. Abortando envio.`);
    return {
      success: false,
      log: 'Cancelado: Lead não possui linha digitável.'
    };
  }

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.debt_value);
  const messageText = buildPaymentMessage(lead, valorFormatado);

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  try {
    console.log(`[SMS/RCS] Enviando mensagem via agente '${senderAgent}' para ${cleanedPhone}...`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey
      },
      body: JSON.stringify({
        sender: senderAgent,
        destinations: [
          {
            to: cleanedPhone,
            messageid: `lead_${lead.id || Date.now()}_${Date.now()}`
          }
        ],
        text: messageText,
        fallback: true
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Erro API SMS: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText);

    if (data.error) {
      throw new Error(`SMS recusou o envio: ${data.errorMessage}`);
    }

    const txId = data.transactionId || 'OK';

    console.log(`[SMS/RCS] Mensagem enviada com sucesso para ${cleanedPhone}. Transaction ID: ${txId}`);
    return {
      success: true,
      log: `[Smart RCS] Enviado com sucesso. Transaction ID: ${txId}`
    };
  } catch (error) {
    console.error(`[SMS/RCS ERROR] Falha ao enviar para lead #${lead.id}:`, error.message);
    return {
      success: false,
      log: `[Smart RCS] Falha no envio: ${error.message}`
    };
  }
}

/**
 * Dispara SMS curto pela API DDM via GET.
 *
 * @param {object} lead - O objeto do lead
 * @returns {Promise<{success: boolean, log: string}>}
 */
// ==========================================
// FILA SEQUENCIAL DE DISPARO DE SMS (400ms)
// ==========================================
const smsQueue = [];
let isProcessingQueue = false;

async function processSmsQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (smsQueue.length > 0) {
    const item = smsQueue.shift();
    const { lead, resolve } = item;

    try {
      console.log(`[SMS QUEUE] Processando Lead #${lead.id} (${lead.name || lead.phone}). Restantes na fila: ${smsQueue.length}`);
      const result = await executeDdmShortSmsWithRetry(lead);
      resolve(result);
    } catch (err) {
      resolve({ success: false, log: `[DDM SMS] Erro na fila: ${err.message}` });
    }

    // Intervalo de proteção de 400ms entre cada envio para não sobrecarregar a API DDM
    if (smsQueue.length > 0) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  isProcessingQueue = false;
}

/**
 * Enfileira um disparo de SMS para processamento sequencial controlado
 */
function enqueueDdmSms(lead) {
  return new Promise((resolve) => {
    smsQueue.push({ lead, resolve });
    console.log(`[SMS QUEUE] Lead #${lead.id} adicionado à fila. Tamanho da fila: ${smsQueue.length}`);
    processSmsQueue().catch(err => {
      console.error('[SMS QUEUE ERROR]', err);
    });
  });
}

const https = require('https');
const http = require('http');

/**
 * Cliente HTTP/HTTPS ultra-resiliente para a API da DDM com bypass de TLS e cabeçalhos de navegador
 */
function sendDdmHttpRequest(targetUrl) {
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          },
          timeout: 10000
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
        req.destroy(new Error('Timeout de 10s na conexão com API DDM'));
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
 * Disparo real de SMS com até 3 retentativas automáticas e backoff
 */
async function executeDdmShortSmsWithRetry(lead) {
  const apiUrl = process.env.DDM_SHORT_SMS_URL || 'https://ddmacordos.com/ddm_api/Envia_SMS/enviaShort.php';

  const targetPhone = process.env.TEST_PHONE || lead.phone;
  if (process.env.TEST_PHONE) {
    console.log(`[DDM SMS - MODO TESTE] Redirecionando mensagem do Lead #${lead.id} (${lead.phone}) para o número de teste: ${targetPhone}`);
  }

  let cleanedPhone = String(targetPhone).replace(/\D/g, '');
  if (cleanedPhone.startsWith('55') && cleanedPhone.length > 11) {
    cleanedPhone = cleanedPhone.slice(2);
  }

  if (!cleanedPhone || cleanedPhone.length < 10) {
    return {
      success: false,
      log: `[DDM SMS] Cancelado: telefone inválido (${targetPhone || 'vazio'}).`
    };
  }

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.debt_value);

  // Enviar a mensagem 100% limpa apenas com o texto da Vero e os 47 dígitos puros (sem nenhum link, URL ou domínio de site)
  const cleanBarcode = String(lead.barcode || '').replace(/\D/g, '').trim();
  const messageText = lead.barcode
    ? `${cleanBarcode} Vero: fatura em aberto ${valorFormatado}.`
    : `Vero: obrigado por atender nosso contato. Em breve enviaremos mais informacoes sobre sua fatura.`;

  const msgCleaned = messageText.replace(/[\r\n]+/g, ' ').trim();
  const url = `${apiUrl}?tel_envio=${encodeURIComponent(cleanedPhone)}&msg_envio=${encodeURIComponent(msgCleaned)}`;

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[DDM SMS] Enviando 1 SMS para ${cleanedPhone} (Tentativa ${attempt}/3)...`);
      
      let response;
      try {
        response = await sendDdmHttpRequest(url);
      } catch (nativeErr) {
        response = await fetch(url, { method: 'GET' });
      }

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`Erro API DDM SMS: ${response.status} - ${responseText}`);
      }

      // Validação estrita: se a API da DDM devolver apenas '<br>' ou resposta vazia sem transacaoId/sucesso, aciona retry
      const isBrokerAccepted = responseText.includes('Message sent successfully') || 
                               responseText.includes('transacaoId') || 
                               responseText.includes('"id"') ||
                               responseText.includes('sucesso') ||
                               responseText.includes('OK');

      if (!isBrokerAccepted && (responseText.trim() === '<br>' || responseText.trim() === '')) {
        throw new Error(`API DDM não gerou ID de envio na Smart SMS (retornou apenas <br>).`);
      }

      console.log(`[DDM SMS] SMS aceito com sucesso pela Smart SMS para Lead #${lead.id}: ${responseText}`);
      return {
        success: true,
        log: `[DDM SMS] Enviado e aceito na Smart SMS. Resposta: ${responseText || 'OK'}`
      };
    } catch (error) {
      lastError = error;
      console.warn(`[DDM SMS WARN] Tentativa ${attempt}/3 falhou para Lead #${lead.id}: ${error.message}`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.error(`[DDM SMS ERROR] Falha definitiva após 3 tentativas para lead #${lead.id}:`, lastError?.message);
  return {
    success: false,
    log: `[DDM SMS] Falha no envio: ${lastError?.message || 'Erro desconhecido'}`
  };
}

/**
 * Dispara SMS curto pela API DDM via fila com controle de concorrência.
 */
async function triggerDdmShortSms(lead) {
  return await enqueueDdmSms(lead);
}

/**
 * Roteador de mensagens SMS/RCS: Prioriza Smart RCS (com fallback SMS automático de operadora).
 * Se a API Smart RCS falhar ou estiver inacessível, recorre à API DDM enviaShort.
 */
async function dispatchSmsOrRcs(lead) {
  try {
    const rcsRes = await triggerSmartRcs(lead);
    if (rcsRes && rcsRes.success) {
      return rcsRes;
    }
    console.warn(`[DISPATCH FALLBACK] Smart RCS não confirmou envio para lead #${lead.id} (${rcsRes?.log}). Tentando via DDM Short SMS...`);
  } catch (err) {
    console.warn(`[DISPATCH FALLBACK] Falha ao disparar Smart RCS: ${err.message}. Tentando via DDM Short SMS...`);
  }

  return await enqueueDdmSms(lead);
}

module.exports = { 
  triggerN8NSmsWebhook: dispatchSmsOrRcs,
  dispatchSmsOrRcs,
  triggerDdmShortSms,
  triggerUnipixSms,
  triggerSmartRcs,
  sendLocawebEmail
};
