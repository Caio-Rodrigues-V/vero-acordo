# 📞 Vero Acordo — Orquestrador de Voz IA & Negociação

Plataforma de alta performance para orquestração de chamadas de voz com inteligência artificial via **Dialog DDM Voice AI Gateway (MeuDiscador)** e integração em tempo real com as APIs de negociação da **Vero Acordo (meuacordofacil)**.

---

## 🚀 Principais Funcionalidades

1. **Discador Automatizado via Dialog DDM (MeuDiscador):**
   - Disparo massivo com controle de ritmo (*pace delay*) e concorrência ajustável por canais SIP.
   - Suporte a múltiplos assistentes/agentes de voz criados no Dialog DDM.
   - Injeção dinâmica de variáveis (`nome`, `telefone`, `cpf`, etc.) para o prompt da IA.

2. **Integração Completa com a API Vero Acordo (meuacordofacil):**
   - `GET /api/vero/check?cpf=...` — Consulta dados do cliente e contratos.
   - `GET /api/vero/simulacao?cpf=...` — Simulação de proposta à vista.
   - `GET /api/vero/simulacoes?cpf=...` — Simulações de parcelamento (1x a 12x).
   - `ALL /api/vero/conclusao?cpf=...` — Fechamento de acordo à vista.
   - `ALL /api/vero/conclusao-parcela?cpf=...&parcelas=X` — Fechamento de acordo parcelado.
   - `GET /api/vero/acordo?cpf=...` — Consulta de acordo formalizado.

3. **Tool Calls em Tempo Real para o Agente de IA:**
   - Durante a ligação, a IA pode consultar os dados e propostas do cliente diretamente na API da Vero e fechar acordos ao vivo na chamada.

4. **Frontend Moderno & Dashboard Operacional:**
   - **Métricas de Discagem:** Base total de leads, volume discado, chamadas atendidas (*alô*), não atendidas e taxa de *Hit Rate %*.
   - **Gráficos Horários:** Volumetria por hora e distribuição de ocorrências/tabulações reais.
   - **Visualizador de Leads:** Busca por Nome, Telefone e CPF com player de áudio da gravação e visualizador de transcrição do diálogo.
   - **Importação Ágil:** Upload e parsing instantâneo de planilhas `.xlsx`, `.xls` e `.csv`.

---

## 🛠️ Configuração de Ambiente (`.env`)

Crie ou edite o arquivo `backend/.env`:

```env
PORT=3001
NODE_ENV=production
APP_BASE_URL=https://verolembrete.grupoddm.ia.br

# Provedor padrão de discagem
DIALER_PROVIDER=dialddm

# Dialog DDM Voice AI Gateway
DIALDDM_BASE_URL=https://dialddm.grupoddm.ia.br/v1
DIALDDM_API_KEY=sua_chave_api_aqui
DIALDDM_DEFAULT_ASSISTANT_ID=5
DIALDDM_PHONE_NUMBER_ID=oktor_sip_500ch
DIALDDM_MAX_CONCURRENCY=50

# Pacing e Lotes de Chamadas
WORKER_DELAY_BETWEEN_CALLS_MS=1500
WORKER_CALL_BATCH_SIZE=14
MAX_CONCURRENT_CALLS=50

# Vero Acordo API (meuacordofacil)
VERO_ACORDO_BASE_URL=https://vero2.meuacordofacil.com.br/api/cliente
VERO_ACORDO_USER=seu_usuario_aqui
VERO_ACORDO_PASS=sua_senha_aqui
```

---

## 📦 Como Rodar Localmente

### Backend:
```bash
cd backend
npm install
node app.js
```

### Frontend (Desenvolvimento):
```bash
cd frontend
npm install
npm run dev
```

### Build do Frontend para Produção:
```bash
cd frontend
npm run build
```
*(O build compila o frontend e copia automaticamente para `backend/public`)*
