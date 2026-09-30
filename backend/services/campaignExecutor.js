const { run, get, all } = require('../db.js');
const { triggerN8NSmsWebhook } = require('./communication.js');
const { makeVapiCall } = require('./vapi.js');

const activeJobs = new Set();

/**
 * Processa o envio de leads: Ligação pela VAPI ou Retell AI
 */
async function processCampaign(campaignId, force = false) {
  if (force) {
    activeJobs.delete(campaignId);
  } else if (activeJobs.has(campaignId)) {
    return;
  }
  activeJobs.add(campaignId);

  const paceDelayMs = parseInt(process.env.WORKER_DELAY_BETWEEN_CALLS_MS || process.env.CALL_PACE_DELAY_MS || '1500', 10);
  const safePaceDelay = isNaN(paceDelayMs) || paceDelayMs < 100 ? 1500 : paceDelayMs;
  
  const envMaxConcurrency = parseInt(process.env.MAX_CONCURRENT_CALLS || process.env.DIALDDM_MAX_CONCURRENCY || '50', 10);
  const defaultConcurrency = isNaN(envMaxConcurrency) || envMaxConcurrency <= 0 ? 50 : envMaxConcurrency;

  const batchSizeValue = parseInt(process.env.WORKER_CALL_BATCH_SIZE || process.env.BATCH_SIZE || String(defaultConcurrency), 10);
  const safeBatchSize = isNaN(batchSizeValue) || batchSizeValue <= 0 ? defaultConcurrency : batchSizeValue;

  console.log(`[EXECUTOR] Iniciando processamento da campanha #${campaignId} (Concorrência Máx: até ${defaultConcurrency} simultâneas | Lote: até ${safeBatchSize} chamadas | Pace Delay SIP: ${safePaceDelay}ms)`);

  try {
    while (activeJobs.has(campaignId)) {
      // 1. Verificar se a campanha ainda está 'processing'
      const campaign = get('SELECT id, name, status, concurrency_limit, dialer_provider FROM campaigns WHERE id = ?', [campaignId]);
      if (!campaign || campaign.status !== 'processing') {
        console.log(`[EXECUTOR] Campanha #${campaignId} foi pausada ou finalizada. Interrompendo robô.`);
        activeJobs.delete(campaignId);
        break;
      }

      const provider = (campaign.dialer_provider || process.env.DIALER_PROVIDER || 'dialddm').toLowerCase();

      // Auto-limpeza de segurança: resetar ou falhar chamadas presas em 'calling'/'in_progress' há mais de 3 minutos
      run(
        `UPDATE leads 
         SET call_status = 'failed', sms_status = 'failed', sms_log = 'Cancelado: Timeout de chamada.', email_status = 'failed', email_log = 'Cancelado: Timeout de chamada.', occurrence = '999 - TIMEOUT_DISCAGEM', call_log = 'Timeout: Chamada sem callback do provedor por mais de 3 minutos', updated_at = CURRENT_TIMESTAMP 
         WHERE campaign_id = ? AND call_status IN ('calling', 'in_progress') AND datetime(COALESCE(updated_at, created_at, '1970-01-01')) < datetime('now', '-3 minutes')`,
        [campaignId]
      );

      // 2. Verificar limite de chamadas ativas simultâneas (Modular e dinâmico)
      const campaignLimit = campaign.concurrency_limit ? parseInt(campaign.concurrency_limit, 10) : defaultConcurrency;
      const concurrencyLimit = isNaN(campaignLimit) || campaignLimit <= 0 ? defaultConcurrency : campaignLimit;

      const activeCallsObj = get(
        `SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND call_status IN ('calling', 'in_progress')`,
        [campaignId]
      );
      const activeCalls = activeCallsObj ? activeCallsObj.count : 0;

      if (activeCalls >= concurrencyLimit) {
        // Aguarda 500ms antes de checar novamente a fila de concorrência
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // 3. Pegar um lote de leads pendentes para preencher a concorrência mais rápido
      const availableSlots = Math.max(concurrencyLimit - activeCalls, 0);
      const dispatchLimit = Math.min(availableSlots, safeBatchSize);
      const leads = all(
        `SELECT * FROM leads 
         WHERE campaign_id = ? 
           AND call_status = 'pending'
         ORDER BY id ASC 
         LIMIT ?`,
        [campaignId, dispatchLimit]
      );

      if (!leads || leads.length === 0) {
        // Se não houver nenhum lead 'pending', mas restarem leads falhados/não contatados na campanha, reenfileira automaticamente para dar continuidade
        const uncontactedFailed = get(
          `SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND call_status IN ('failed', 'calling')`,
          [campaignId]
        );

        if (uncontactedFailed && uncontactedFailed.count > 0 && activeCalls === 0) {
          console.log(`[EXECUTOR] Reenfileirando ${uncontactedFailed.count} leads falhados/não contatados para dar continuidade automática à campanha #${campaignId}...`);
          run("UPDATE leads SET call_status = 'pending', call_log = 'Reenfileirado para continuidade do lote' WHERE campaign_id = ? AND call_status IN ('failed', 'calling')", [campaignId]);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue; // Continua a discagem no próximo ciclo do while!
        }

        // Verificar se ainda restam ligações ativas rodando antes de concluir
        if (activeCalls === 0) {
          console.log(`[EXECUTOR] Todos os leads da campanha #${campaignId} foram finalizados com sucesso.`);
          run("UPDATE campaigns SET status = 'completed' WHERE id = ?", [campaignId]);
        }
        break;
      }

      await Promise.all(leads.map(async (lead) => {
        // Marcar o lead como 'calling' no banco temporariamente
        run(
          `UPDATE leads 
           SET call_status = 'calling', call_log = 'Iniciando discagem ${provider.toUpperCase()}...', updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [lead.id]
        );

        // 5. Disparar a chamada para DIAL DDM, RETELL AI ou VAPI (Lazy-load para proteger instâncias)
        try {
          let callResult;
          if (provider === 'retell') {
            const { makeRetellCall } = require('./retell.js');
            callResult = await makeRetellCall(lead);
          } else if (provider === 'dialddm') {
            const { makeDialDdmCall } = require('./dialddm.js');
            callResult = await makeDialDdmCall(lead);
          } else {
            callResult = await makeVapiCall(lead);
          }

          if (!callResult.success) {
            const isConcurrencyError = callResult.log && (
              callResult.log.toLowerCase().includes('concurrency') ||
              callResult.log.toLowerCase().includes('rate limit') ||
              callResult.log.toLowerCase().includes('too many') ||
              callResult.log.toLowerCase().includes('quota') ||
              callResult.log.includes('429')
            );

            if (isConcurrencyError) {
              console.log(`[EXECUTOR CONCORRÊNCIA] Limite de concorrência/rate limit (${provider.toUpperCase()}) atingido. Devolvendo lead #${lead.id} para a fila...`);
              run(
                `UPDATE leads SET call_status = 'pending', call_log = 'Aguardando liberação de vaga no canal...', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [lead.id]
              );
              return;
            }

            // Falha permanente no número/discagem
            run(
              `UPDATE leads 
               SET call_status = 'failed', call_log = ?, sms_status = 'failed', sms_log = 'Cancelado: Falha na chamada.', email_status = 'failed', email_log = 'Cancelado: Falha na chamada.', call_attempts = call_attempts + 1, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [callResult.log, lead.id]
            );
            run(
              `UPDATE campaigns 
               SET processed_leads = processed_leads + 1, failed_calls = failed_calls + 1, failed_sms = failed_sms + 1 
               WHERE id = ?`,
              [campaignId]
            );
          } else {
            // Chamada iniciada na VAPI com sucesso, aguardando webhook de finalização
            run(
              `UPDATE leads 
               SET call_log = ?, call_attempts = call_attempts + 1, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [callResult.log, lead.id]
            );
          }
        } catch (err) {
          console.error(`[EXECUTOR ERROR] Falha no disparo do lead #${lead.id}:`, err.message);
          run(
            `UPDATE leads SET call_status = 'failed', sms_status = 'failed', sms_log = 'Cancelado: Erro de execução.', email_status = 'failed', email_log = 'Cancelado: Erro de execução.', call_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [`Erro de execução: ${err.message}`, lead.id]
          );
        }
      }));

      // 6. Intervalo entre lotes para manter fluxo constante e estável
      await new Promise((resolve) => setTimeout(resolve, safePaceDelay));
    }
  } catch (error) {
    console.error(`[EXECUTOR] Erro ao processar campanha #${campaignId}:`, error);
  } finally {
    activeJobs.delete(campaignId);
  }
}

/**
 * Aciona o processador para verificar se há campanhas com leads pendentes
 */
function triggerCampaignProcessor(campaignIdToForce = null) {
  if (campaignIdToForce) {
    run("UPDATE leads SET call_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND call_status = 'calling'", [campaignIdToForce]);
    processCampaign(campaignIdToForce, true);
    return;
  }

  const processingCampaigns = all("SELECT id FROM campaigns WHERE status = 'processing'");
  for (const row of processingCampaigns) {
    const pendingCount = get("SELECT COUNT(id) as count FROM leads WHERE campaign_id = ? AND call_status = 'pending'", [row.id]);
    if (pendingCount && pendingCount.count > 0) {
      processCampaign(row.id, !activeJobs.has(row.id));
    }
  }
}

/**
 * Inicia o loop de monitoramento
 */
function startMonitorLoop() {
  setInterval(() => {
    triggerCampaignProcessor();
  }, 5000);
}

module.exports = { triggerCampaignProcessor, startMonitorLoop };
