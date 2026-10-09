const { run, get } = require('../db.js');
const { triggerN8NSmsWebhook } = require('./communication.js');
const { updateCampaignStats } = require('./stats.js');
const { classifyCallOccurrence } = require('../utils/classifier.js');

/**
 * Disparar ligação de cobrança via Retell AI API
 * @param {Object} lead - Dados do lead
 * @returns {Promise<Object>} Resultado da chamada
 */
async function makeRetellCall(lead) {
  const apiKey = process.env.RETELL_API_KEY || 'key_a5dbdb38e3718d2aaa70862d1ad8';
  const agentId = process.env.RETELL_AGENT_ID || 'agent_a48bf93903981faa827f4a8261';
  const fromNumber = process.env.RETELL_FROM_NUMBER || '551153301578';

  // Buscar assistente selecionado na campanha se houver
  let campaignAgentId = agentId;
  try {
    const campaign = get('SELECT vapi_assistant_id FROM campaigns WHERE id = ?', [lead.campaign_id]);
    if (campaign && campaign.vapi_assistant_id && campaign.vapi_assistant_id.startsWith('agent_')) {
      campaignAgentId = campaign.vapi_assistant_id;
    }
  } catch (err) {
    console.error('Erro ao buscar agent_id da campanha para Retell:', err.message);
  }

  // Garantir número formatado em E.164
  let phone = (lead.phone || '').trim().replace(/\D/g, '');
  if (!phone.startsWith('55')) {
    phone = '55' + phone;
  }

  // Sanitizar o número de telefone removendo caracteres não numéricos
  const cleanPhone = (lead.phone || '').replace(/\D/g, '');
  const techPrefix = process.env.RETELL_TECH_PREFIX || process.env.OKTOR_TECH_PREFIX || '59083';
  const toNumber = techPrefix ? (techPrefix + cleanPhone) : ('+' + cleanPhone);

  console.log('[RETELL] Disparando chamada para Lead #' + lead.id + ' (' + lead.name + ') -> ' + toNumber + ' (BINA: ' + fromNumber + ')');

  const rawName = (lead.name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/TESTE PROD/gi, '')
    .trim() || lead.name || 'Cliente';

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

  try {
    const response = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_number: fromNumber,
        to_number: toNumber,
        override_agent_id: campaignAgentId,
        retell_llm_dynamic_variables: {
          nome: shortName,
          nome_cliente: shortName,
          valor: lead.debt_value ? ('R$ ' + lead.debt_value) : 'seu débito pendente',
          valor_fatura: lead.debt_value ? ('R$ ' + lead.debt_value) : 'seu débito pendente',
          vencimento: lead.due_date || 'data recente',
          contrato: lead.contract_number || 'N/A'
        }
      })
    });

    const data = await response.json();

    if (data && data.call_id) {
      console.log('[RETELL] Chamada registrada com sucesso! Call ID: ' + data.call_id);
      
      // Atualizar lead no banco local com o call_id da Retell
      run(
        'UPDATE leads SET call_id = ?, call_status = \'in_progress\' WHERE id = ?',
        [data.call_id, lead.id]
      );

      return { success: true, callId: data.call_id, log: 'Chamada Retell iniciada com sucesso. ID: ' + data.call_id };
    } else {
      const errMsg = data.message || data.error || JSON.stringify(data);
      console.error('[RETELL] Erro no retorno da API Retell:', errMsg);
      return { success: false, log: 'Erro Retell API: ' + errMsg };
    }

  } catch (error) {
    console.error('[RETELL] Exceção ao chamar API da Retell:', error.message);
    return { success: false, log: 'Exceção Retell API: ' + error.message };
  }
}

/**
 * Processar Webhook enviado pela Retell AI (call_ended, call_analyzed, etc.)
 */
async function handleRetellWebhook(eventData) {
  const event = eventData.event;
  const call = eventData.call || eventData;

  if (!call || !call.call_id) {
    return { status: 'ignored', reason: 'Payload sem call_id' };
  }

  console.log('[RETELL WEBHOOK] Evento: ' + event + ' | Call ID: ' + call.call_id + ' | Status: ' + call.call_status);

  // Buscar o lead correspondente a essa chamada no banco
  const lead = get('SELECT * FROM leads WHERE call_id = ?', [call.call_id]);
  if (!lead) {
    console.log('[RETELL WEBHOOK] Lead não encontrado no banco local para Call ID: ' + call.call_id);
    return { status: 'ignored', reason: 'Lead não encontrado' };
  }

  // Se o evento for de encerramento de chamada
  if (event === 'call_ended' || event === 'call_analyzed' || call.call_status === 'ended') {
    const disconnectionReason = call.disconnection_reason || 'call_ended';
    const transcript = call.transcript || (call.transcript_object ? call.transcript_object.map(t => (t.role.toUpperCase() + ': ' + t.content)).join('\n') : '');
    const durationSeconds = Math.round((call.end_timestamp - call.start_timestamp) / 1000) || 0;
    
    // Normalizar endedReason para o formato do classificador
    let normalizedEndedReason = disconnectionReason;
    if (disconnectionReason.includes('no_answer')) normalizedEndedReason = 'no-answer';
    else if (disconnectionReason.includes('user_busy')) normalizedEndedReason = 'busy';
    else if (disconnectionReason.includes('voicemail')) normalizedEndedReason = 'voicemail';
    else if (disconnectionReason.includes('dial_failed') || disconnectionReason.includes('error')) normalizedEndedReason = 'error';

    const summary = call.call_analysis?.call_summary || '';
    const occurrenceText = classifyCallOccurrence({
      endedReason: normalizedEndedReason,
      summary: summary,
      transcript: transcript,
      duration: durationSeconds
    });

    // Mapear resultado: atendeu e desligou e mudo também são considerados atendidos para disparo de SMS
    let finalCallStatus = 'completed';
    if (
      occurrenceText === 'CAIXA POSTAL' || 
      disconnectionReason.includes('voicemail') ||
      normalizedEndedReason === 'voicemail'
    ) {
      finalCallStatus = 'failed';
    } else if (
      occurrenceText === 'ATENDEU E DESLIGOU' || 
      occurrenceText === 'LIGAÇÃO MUDA' ||
      occurrenceText.startsWith('ATENDEU')
    ) {
      finalCallStatus = 'completed';
    } else if (disconnectionReason.includes('no_answer') || disconnectionReason.includes('user_busy')) {
      finalCallStatus = 'failed';
    } else if (disconnectionReason.includes('dial_failed') || disconnectionReason.includes('error')) {
      finalCallStatus = 'failed';
    }

    const recordingUrl = call.recording_url || call.public_log_url || call.call_analysis?.recording_url || null;

    // Gravar no banco de dados local
    run(
      'UPDATE leads SET call_status = ?, call_duration = ?, transcript = ?, occurrence = ?, recording_url = COALESCE(?, recording_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [finalCallStatus, durationSeconds, transcript, occurrenceText, recordingUrl, lead.id]
    );

    // Regra estrita: só envia RCS/SMS se houve formalização de acordo ou promessa de pagamento
    const isAgreement = occurrenceText.includes('PROMESSA') || occurrenceText.includes('ACORDO');
    if (finalCallStatus === 'completed' && isAgreement) {
      console.log('[RETELL WEBHOOK] Processando envio de RCS para Lead #' + lead.id + ' por acordo formalizado...');
      const smsResult = await triggerN8NSmsWebhook(lead).catch(err => ({ success: false, log: '[RETELL RCS ERROR] ' + err.message }));
      const smsStatus = smsResult.success ? 'completed' : 'failed';
      run(
        'UPDATE leads SET sms_status = ?, sms_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [
          smsStatus, 
          smsResult.success ? '[SMS] Enviado com sucesso: chamada atendida.' : smsResult.log,
          lead.id
        ]
      );
    } else {
      const cancelReason = 'Não enviado: Chamada falhou (' + disconnectionReason + ').';
      
      run(
        'UPDATE leads SET sms_status = \'failed\', sms_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cancelReason, lead.id]
      );
    }

    // Recalcular estatísticas da campanha
    try {
      updateCampaignStats(lead.campaign_id);
    } catch (e) {
      console.error('[RETELL STATS UPDATE ERROR]', e.message);
    }

    return { status: 'success', leadId: lead.id, callStatus: finalCallStatus };
  }

  return { status: 'received' };
}

module.exports = {
  makeRetellCall,
  handleRetellWebhook
};
