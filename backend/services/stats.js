const { get, run } = require('../db.js');

/**
const { get, run } = require('../db.js');

/**
 * Recalcula e atualiza as estatísticas acumuladas de uma campanha no banco de dados.
 * @param {number} campaignId ID da campanha
 */
function updateCampaignStats(campaignId) {
  if (!campaignId) return;
  try {
    const stats = get(`
      SELECT 
        COUNT(id) as total,
        SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) as successful_calls,
        SUM(CASE WHEN call_status = 'failed' THEN 1 ELSE 0 END) as failed_calls,
        SUM(CASE WHEN call_status IN ('completed', 'failed') THEN 1 ELSE 0 END) as processed
      FROM leads
      WHERE campaign_id = ?
    `, [campaignId]);

    run(`
      UPDATE campaigns 
      SET processed_leads = ?,
          successful_calls = ?,
          failed_calls = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      stats ? (stats.processed || 0) : 0,
      stats ? (stats.successful_calls || 0) : 0,
      stats ? (stats.failed_calls || 0) : 0,
      campaignId
    ]);

    // Verificar se todos os leads desta campanha foram finalizados
    const pendingLeads = get(`
      SELECT COUNT(id) as count 
      FROM leads 
      WHERE campaign_id = ? 
        AND call_status IN ('pending', 'processing', 'calling', 'in_progress')
    `, [campaignId]);

    if (pendingLeads && pendingLeads.count === 0) {
      run("UPDATE campaigns SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [campaignId]);
      console.log(`[SERVER] Campanha #${campaignId} marcada como CONCLUÍDA.`);
    }
  } catch (err) {
    console.error('[STATS UPDATE ERROR]', err.message);
  }
}

module.exports = {
  updateCampaignStats
};
