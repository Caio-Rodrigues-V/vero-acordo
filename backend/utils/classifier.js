/**
 * Lista de ocorrências qualificadas de CPC (Contato com a Pessoa Certa) que justificam
 * o envio automático de SMS / e-mail.
 */
const validCpcOccurrences = [
  'ATENDEU - SMS ENVIADO',
  'CONFIRMOU CONTATO - ENVIO SMS',
  'PROMESSA DE PAGAMENTO - SMS ENVIADO',
  '2ª VIA BOLETO - SMS ENVIADO',
  'ALEGA PAGAMENTO - SMS ENVIADO',
  'ATENDEU E DESLIGOU',
  'LIGAÇÃO MUDA'
];

/**
 * Normaliza o texto removendo acentos e caracteres especiais para comparação insensível
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extrai apenas as falas do cliente a partir da transcrição completa
 */
function extractCustomerSpeech(transcript) {
  if (!transcript) return '';
  if (transcript.includes('# PERSONA') || transcript.includes('# REGRAS')) {
    transcript = transcript.replace(/# PERSONA[\s\S]*?(?=(Vero:|Cliente:|$))/i, '');
  }
  const lines = transcript.split('\n');
  const customerLines = [];

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith('vero:') || lower.startsWith('vêro:') || lower.startsWith('assistant:') || lower.startsWith('bot:') || lower.startsWith('ai:')) {
      continue;
    }
    if (lower.startsWith('#') || lower.startsWith('**') || lower.includes('end_call') || lower.includes('voicemail_tool')) {
      continue;
    }
    if (lower.startsWith('user:') || lower.startsWith('customer:') || lower.startsWith('cliente:')) {
      customerLines.push(line.replace(/^(user|customer|cliente):/i, '').trim());
    } else {
      customerLines.push(line.trim());
    }
  }

  return customerLines.join(' ');
}

/**
 * Classifica a ocorrência de uma chamada telefônica, com suporte nativo às
 * tabulações Olos / DDM e VAPI/Retell.
 */
function classifyCallOccurrence({ endedReason, summary, transcript, duration, tabulation, tabulationCode }) {
  const reason = String(endedReason || '').toLowerCase();
  const dur = Number(duration || 0);
  const tab = normalizeText(tabulation || '').toUpperCase().trim();
  const code = (tabulationCode || '').toUpperCase().trim();

  const customerSpeech = extractCustomerSpeech(transcript || '');
  const hasSpeech = customerSpeech.trim().length > 0;

  // 1. Falhas, não atendimento ou recusa imediata (< 3s e sem voz do cliente)
  if (
    dur === 0 || 
    (dur < 3 && !hasSpeech) ||
    reason === 'no-answer' || 
    reason === 'no_answer' || 
    reason === 'customer-did-not-answer' || 
    reason === 'busy' || 
    reason === 'user_busy' || 
    reason === 'customer-busy' || 
    reason === 'dial_failed'
  ) {
    if (
      tab === 'CAIXA_POSTAL' || 
      tab.includes('CAIXA_POSTAL') || 
      tab.includes('CAIXA POSTAL') || 
      tab.includes('VOICEMAIL') || 
      tab.includes('SECRETARIA') || 
      code === 'VOICEMAIL' || 
      reason.includes('voicemail')
    ) {
      return 'CAIXA POSTAL';
    }
    return 'NÃO ATENDEU';
  }

  // 2. Caixa Postal com qualquer duração
  if (
    tab === 'CAIXA_POSTAL' || 
    tab.includes('CAIXA_POSTAL') || 
    tab.includes('CAIXA POSTAL') || 
    tab.includes('VOICEMAIL') || 
    tab.includes('SECRETARIA') || 
    code === 'VOICEMAIL' || 
    reason.includes('voicemail')
  ) {
    return 'CAIXA POSTAL';
  }

  // 3. Detecção semântica profunda na conversa (transcrição e resumo)
  // DEVE RODAR ANTES de checagens técnicas genéricas de tabulation/endedReason
  const fullText = normalizeText(`${summary || ''} ${transcript || ''}`);

  // Se o diálogo indica que o cliente aceitou, confirmou ou pediu o boleto/acordo
  const hasPromiseSignal = (
    fullText.includes('promessa de pagamento') ||
    fullText.includes('confirmou o pagamento') ||
    fullText.includes('aceitou a proposta') ||
    fullText.includes('aceitou a oferta') ||
    fullText.includes('fechar essa proposta') ||
    fullText.includes('fechar a proposta') ||
    fullText.includes('fechar acordo') ||
    fullText.includes('quero fechar') ||
    fullText.includes('vou fechar') ||
    fullText.includes('pode fechar') ||
    fullText.includes('acordo parcelado') ||
    fullText.includes('enviarei o boleto') ||
    fullText.includes('enviar o boleto') ||
    fullText.includes('enviar o link') ||
    fullText.includes('manda o boleto') ||
    fullText.includes('manda por email') ||
    fullText.includes('manda no email') ||
    fullText.includes('manda no zap') ||
    fullText.includes('manda no whatsapp') ||
    fullText.includes('manda no celular') ||
    fullText.includes('pode mandar') ||
    fullText.includes('pode enviar') ||
    fullText.includes('vou pagar') ||
    fullText.includes('pago amanha') ||
    fullText.includes('pago hoje') ||
    fullText.includes('esse acordo e uma prova documental') ||
    fullText.includes('acordo e uma prova documental') ||
    fullText.includes('contamos com a sua pontualidade') ||
    fullText.includes('posso confirmar o pagamento ate amanha') && fullText.includes('pode')
  );

  if (hasPromiseSignal && dur >= 3) {
    return 'PROMESSA DE PAGAMENTO - SMS ENVIADO';
  }

  // Se o cliente alegou que já pagou
  if (fullText.includes('ja paguei') || fullText.includes('ja fiz o pagamento') || fullText.includes('ja esta pago') || fullText.includes('alega pagamento')) {
    return 'ALEGA PAGAMENTO - SMS ENVIADO';
  }

  // Se houve recusa explícita no diálogo
  if (
    fullText.includes('recusa de pagamento') || 
    fullText.includes('nao tem interesse') || 
    fullText.includes('nao tenho interesse') || 
    fullText.includes('sem interesse') || 
    fullText.includes('nao vou pagar') || 
    fullText.includes('nao quero pagar') || 
    fullText.includes('nao quer pagar') || 
    fullText.includes('nao deseja negociar') ||
    fullText.includes('nao desejo negociar')
  ) {
    return 'RECUSA DE PAGAMENTO';
  }

  // 4. Tabulações explícitas retornadas pela IA/Gateway
  if (tabulation && typeof tabulation === 'string' && tabulation.trim().length > 0) {
    const cleanTab = tabulation.replace(/_/g, ' ').trim().toUpperCase();
    if (cleanTab.includes('PROMESSA') || cleanTab.includes('ACORDO')) {
      return 'PROMESSA DE PAGAMENTO - SMS ENVIADO';
    }
    if (cleanTab.includes('BOLETO') || cleanTab.includes('2 VIA') || cleanTab.includes('2ª VIA')) {
      return '2ª VIA BOLETO - SMS ENVIADO';
    }
    if (cleanTab.includes('ALEGA')) {
      return 'ALEGA PAGAMENTO - SMS ENVIADO';
    }
    if (cleanTab.includes('RECUSA') || cleanTab.includes('NAO DESEJA') || cleanTab.includes('NÃO DESEJA')) {
      return 'RECUSA DE PAGAMENTO';
    }
    if (cleanTab !== 'CUSTOMER-ENDED-CALL' && cleanTab !== 'USER-HANGUP' && cleanTab !== 'ATENDEU E DESLIGOU' && cleanTab !== 'CALL-DROPPED') {
      return cleanTab;
    }
  }

  // 5. Queda de chamada ou silêncio
  if (
    reason === 'silence-timed-out' || 
    reason === 'silence' ||
    code === 'MUTE_SILENCE'
  ) {
    return 'LIGAÇÃO MUDA';
  }

  // Se o cliente falou e a chamada durou mais de 10s, mas desligou sem recusar nem prometer
  if (dur >= 10 && hasSpeech) {
    return 'ATENDEU - SMS ENVIADO';
  }

  if (
    code === 'CALL_DROPPED' ||
    reason === 'customer-ended-call' ||
    reason === 'user_hangup'
  ) {
    return 'ATENDEU E DESLIGOU';
  }

  // 6. Qualquer chamada conectada com duração > 0
  return 'ATENDEU - SMS ENVIADO';
}

/**
 * Remove qualquer vazamento de prompt de persona/sistema da transcrição
 */
function cleanTranscript(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  if (
    cleaned.includes('# PERSONA') || 
    cleaned.includes('Você é a Verô') || 
    cleaned.includes('# REGRAS') || 
    cleaned.includes('# ETAPA') || 
    cleaned.includes('# CAIXA POSTAL') || 
    cleaned.includes('# ANTI-ALUCINAÇÃO') || 
    cleaned.includes('# CASUALIDADES')
  ) {
    const lines = cleaned.split(/\r?\n/);
    const realLines = [];
    let isInsidePrompt = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('Cliente: #') || 
        trimmed.startsWith('# ') || 
        trimmed.startsWith('Você é a Verô') || 
        trimmed.includes('Seu objetivo:') || 
        trimmed.includes('ANTI-ALUCINAÇÃO') ||
        trimmed.startsWith('# PERSONA')
      ) {
        isInsidePrompt = true;
      }
      
      if (isInsidePrompt) {
        const isSpeakerLine = (
          trimmed.startsWith('Sofia:') || 
          trimmed.startsWith('Vero:') || 
          trimmed.startsWith('Verô:') || 
          trimmed.startsWith('Cliente:') || 
          trimmed.startsWith('Assistente:') ||
          trimmed.startsWith('Bot:') ||
          trimmed.startsWith('User:')
        );
        const isPromptRule = (
          trimmed.includes('#') || 
          trimmed.includes('PERSONA') || 
          trimmed.includes('REGRAS') || 
          trimmed.includes('ETAPA') || 
          trimmed.includes('CASUALIDADES') || 
          trimmed.includes('CAIXA POSTAL') ||
          trimmed.includes('ANTI-ALUCINAÇÃO') ||
          trimmed.includes('Você é a Verô')
        );

        if (isSpeakerLine && !isPromptRule) {
          isInsidePrompt = false;
          realLines.push(trimmed);
        }
      } else {
        realLines.push(line);
      }
    }
    cleaned = realLines.join('\n').trim();
  }

  // Normalizar nomes de agentes para Agente / Cliente
  cleaned = cleaned
    .replace(/^Sofia:/gm, 'Agente:')
    .replace(/^Vero:/gm, 'Agente:')
    .replace(/^Verô:/gm, 'Agente:')
    .replace(/^Assistente:/gm, 'Agente:')
    .replace(/^Bot:/gm, 'Agente:')
    .replace(/^User:/gm, 'Cliente:')
    .replace(/^Customer:/gm, 'Cliente:');

  return cleaned.trim();
}

module.exports = {
  validCpcOccurrences,
  normalizeText,
  extractCustomerSpeech,
  classifyCallOccurrence,
  cleanTranscript
};
