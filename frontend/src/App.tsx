import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  UploadCloud, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  RefreshCw, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  MessageSquare,
  X,
  BarChart2,
  Upload,
  Calendar,
  PhoneCall,
  Volume2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  Legend, 
  PieChart, 
  Pie, 
  Cell,
  CartesianGrid
} from 'recharts';

// Interfaces para os tipos de dados
interface Campaign {
  id: number;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
  total_leads: number;
  processed_leads: number;
  successful_calls: number;
  failed_calls: number;
  created_at: string;
}

interface Lead {
  id: number;
  campaign_id: number;
  name: string;
  phone: string;
  cpf?: string;
  debt_value?: number;
  due_date?: string;
  occurrence?: string;
  call_status: 'pending' | 'processing' | 'calling' | 'completed' | 'failed';
  call_attempts: number;
  call_duration?: number;
  call_log?: string;
  transcript?: string;
  recording_url?: string;
  call_id?: string;
}

interface DashboardStats {
  total_campaigns: number;
  total_leads: number;
  total_unique_leads?: number;
  total_processed: number;
  total_successful_calls: number;
  total_failed_calls: number;
}

const BACKEND_URL = window.location.origin.includes('localhost:5173') ? 'http://localhost:3001' : window.location.origin;

function cleanDisplayTranscript(text: string | undefined): string {
  if (!text) return 'Nenhuma transcrição ou registro gravado para esta chamada.';
  let cleaned = text;

  // Limpar cabeçalhos de sistema ou regras se houver
  if (cleaned.includes('# PERSONA') || cleaned.includes('# REGRAS') || cleaned.includes('Você é')) {
    const lines = cleaned.split(/\r?\n/);
    const realLines: string[] = [];
    let isInsidePrompt = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.includes('ANTI-ALUCINAÇÃO') || trimmed.startsWith('Você é')) {
        isInsidePrompt = true;
      }

      if (isInsidePrompt) {
        const isSpeakerLine = (
          trimmed.startsWith('Agente:') ||
          trimmed.startsWith('Vero:') ||
          trimmed.startsWith('Assistente:') ||
          trimmed.startsWith('Bot:') ||
          trimmed.startsWith('Cliente:') ||
          trimmed.startsWith('User:')
        );
        if (isSpeakerLine && !trimmed.includes('#')) {
          isInsidePrompt = false;
          realLines.push(trimmed);
        }
      } else {
        realLines.push(line);
      }
    }
    cleaned = realLines.join('\n').trim();
  }

  cleaned = cleaned
    .replace(/^Sofia:/gm, 'Agente:')
    .replace(/^Vero:/gm, 'Agente:')
    .replace(/^Verô:/gm, 'Agente:')
    .replace(/^Assistente:/gm, 'Agente:')
    .replace(/^Bot:/gm, 'Agente:')
    .replace(/^User:/gm, 'Cliente:')
    .replace(/^Customer:/gm, 'Cliente:');

  return cleaned.trim() || 'Nenhuma transcrição ou registro gravado para esta chamada.';
}

// Componente Moderno de KPI Card
interface KPICardProps {
  title: string;
  value: string;
  subtitle: string;
  progress?: number;
  indicatorText?: string;
  colorTheme?: 'emerald' | 'cyan' | 'indigo' | 'slate' | 'rose';
}

const ModernKPICard: React.FC<KPICardProps> = ({
  title,
  value,
  subtitle,
  progress,
  indicatorText,
  colorTheme = 'indigo'
}) => {
  const theme = {
    emerald: { bar: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    cyan: { bar: 'bg-sky-500', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
    indigo: { bar: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    slate: { bar: 'bg-slate-700', pill: 'bg-slate-100 text-slate-700 border-slate-200' },
    rose: { bar: 'bg-rose-500', pill: 'bg-rose-50 text-rose-700 border-rose-200' },
  }[colorTheme];

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:border-slate-300 transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
        {indicatorText && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${theme.pill}`}>
            {indicatorText}
          </span>
        )}
      </div>
      
      <div className="my-3">
        <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {value}
        </div>
        <p className="text-xs text-slate-400 mt-1 font-normal">{subtitle}</p>
      </div>

      {progress !== undefined && (
        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-1">
          <div 
            className={`h-full rounded-full transition-all duration-700 ${theme.bar}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'campaigns' | 'leads'>('dashboard');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total_campaigns: 0,
    total_leads: 0,
    total_processed: 0,
    total_successful_calls: 0,
    total_failed_calls: 0,
  });

  // Upload state
  const [campaignName, setCampaignName] = useState('');
  const [assistantId, setAssistantId] = useState('5');
  const [phoneNumberId, setPhoneNumberId] = useState('oktor_sip_500ch');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected Campaign for Leads view (default: 'all')
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | 'all'>('all');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsTotalPages, setLeadsTotalPages] = useState(1);
  const [leadsTotalCount, setLeadsTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTranscriptLead, setSelectedTranscriptLead] = useState<Lead | null>(null);

  // Ocorrências / Tabulações
  const [occurrences, setOccurrences] = useState<{ occurrence: string; count: number }[]>([]);
  
  // BI e Métricas por Horário e Filtro de Data
  const todayIso = new Date().toISOString().split('T')[0];
  const [hourlyData, setHourlyData] = useState<{ hour: string; atendeu: number; naoAtendeu: number; discados: number }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [availableDates, setAvailableDates] = useState<{ date_str: string; total_processed: number; successful_calls: number }[]>([]);
  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(21);

  const fetchAvailableDates = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/dashboard/available-dates`);
      if (res.ok) {
        const data = await res.json();
        setAvailableDates(data);
      }
    } catch (err) {
      console.error('Error fetching available dates:', err);
    }
  };

  const fetchOccurrences = async (campaignId: number | 'all' = 'all', dt: string = selectedDate) => {
    try {
      const dateQuery = (dt && dt !== 'all') ? `&date=${dt}` : '';
      const res = await fetch(`${BACKEND_URL}/api/dashboard/occurrences?campaignId=${campaignId}${dateQuery}`);
      if (res.ok) {
        const data = await res.json();
        setOccurrences(data);
      }
    } catch (err) {
      console.error('Error fetching occurrences:', err);
    }
  };

  const fetchHourlyStats = async (campaignId: number | 'all' = selectedCampaignId, sH: number = startHour, eH: number = endHour, dt: string = selectedDate) => {
    try {
      const dateQuery = (dt && dt !== 'all') ? `&date=${dt}` : '';
      const res = await fetch(`${BACKEND_URL}/api/dashboard/hourly-stats?campaignId=${campaignId}&startHour=${sH}&endHour=${eH}${dateQuery}`);
      if (res.ok) {
        const data = await res.json();
        setHourlyData(data);
      }
    } catch (err) {
      console.error('Error fetching hourly stats:', err);
    }
  };

  const fetchStats = async (campaignId: number | 'all' = selectedCampaignId, dt: string = selectedDate) => {
    try {
      const dateQuery = (dt && dt !== 'all') ? `&date=${dt}` : '';
      const res = await fetch(`${BACKEND_URL}/api/dashboard/stats?campaignId=${campaignId}${dateQuery}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/campaigns`);
      if (res.ok) {
        const data: Campaign[] = await res.json();
        setCampaigns(data);
      }
    } catch (err) {
      console.error('Error fetching campaigns:', err);
    }
  };

  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;
  const leadsPageRef = useRef(leadsPage);
  leadsPageRef.current = leadsPage;

  const fetchLeads = async (campaignId: number | 'all', page: number = leadsPageRef.current, currentStatusFilter: string = statusFilterRef.current, currentSearchTerm: string = searchTermRef.current) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/campaigns/${campaignId}/leads?page=${page}&limit=10&statusFilter=${currentStatusFilter}&search=${encodeURIComponent(currentSearchTerm)}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setLeadsTotalPages(data.pagination.totalPages);
        setLeadsTotalCount(data.pagination.totalLeads);
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
    }
  };

  // Inicialização
  useEffect(() => {
    fetchStats(selectedCampaignId, selectedDate);
    fetchCampaigns();
    fetchOccurrences(selectedCampaignId, selectedDate);
    fetchHourlyStats(selectedCampaignId, 8, 21, selectedDate);
    fetchAvailableDates();
    fetchLeads('all', 1);
  }, []);

  // Auto-refresh contínuo
  useEffect(() => {
    fetchStats(selectedCampaignId, selectedDate);
    fetchCampaigns();
    fetchOccurrences(selectedCampaignId, selectedDate);
    fetchHourlyStats(selectedCampaignId, startHour, endHour, selectedDate);
    fetchAvailableDates();
    if (activeTab === 'leads') {
      fetchLeads(selectedCampaignId, leadsPageRef.current, statusFilterRef.current, searchTermRef.current);
    }

    const interval = setInterval(() => {
      fetchStats(selectedCampaignId, selectedDate);
      fetchCampaigns();
      if (activeTab === 'dashboard') {
        fetchOccurrences(selectedCampaignId, selectedDate);
        fetchHourlyStats(selectedCampaignId, startHour, endHour, selectedDate);
      } else if (activeTab === 'leads') {
        fetchLeads(selectedCampaignId, leadsPageRef.current, statusFilterRef.current, searchTermRef.current);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeTab, selectedCampaignId, leadsPage, statusFilter, searchTerm, startHour, endHour, selectedDate]);

  const handleOpenTranscriptModal = (lead: Lead) => {
    setSelectedTranscriptLead(lead);
    fetch(`${BACKEND_URL}/api/campaigns/lead/${lead.id}`)
      .then(res => res.json())
      .then(fullLead => {
        if (fullLead && !fullLead.error) {
          setSelectedTranscriptLead(fullLead);
        }
      })
      .catch(err => console.error('Error fetching live lead details:', err));
  };

  const handleSync = async () => {
    fetchStats(selectedCampaignId, selectedDate);
    fetchCampaigns();
    fetchAvailableDates();
    fetchLeads(selectedCampaignId, leadsPageRef.current, statusFilterRef.current, searchTermRef.current);
  };

  const handleCampaignSelect = (id: number | 'all') => {
    setSelectedCampaignId(id);
    setLeadsPage(1);
    fetchStats(id, selectedDate);
    fetchOccurrences(id, selectedDate);
    fetchHourlyStats(id, startHour, endHour, selectedDate);
    fetchLeads(id, 1, statusFilter, searchTerm);
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Por favor, selecione um arquivo Excel ou CSV.');
      return;
    }
    if (!campaignName.trim()) {
      setUploadError('Por favor, informe um nome para a campanha.');
      return;
    }

    setUploading(true);
    setUploadError('');
    setUploadSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('campaignName', campaignName.trim());
    formData.append('dialerProvider', 'dialddm');
    formData.append('vapiAssistantId', assistantId);
    formData.append('vapiPhoneNumberId', phoneNumberId);

    try {
      const res = await fetch(`${BACKEND_URL}/api/campaigns/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok) {
        setUploadSuccess(`Campanha #${data.campaignId} criada com ${data.total_leads} leads! Discagem iniciada.`);
        setCampaignName('');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchCampaigns();
        fetchStats();
      } else {
        setUploadError(data.error || 'Erro ao processar planilha.');
      }
    } catch (err) {
      setUploadError('Falha ao conectar com o servidor.');
    } finally {
      setUploading(false);
    }
  };

  const handleStartCampaign = async (id: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/campaigns/${id}/start`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchCampaigns();
      }
    } catch (err) {
      console.error('Error starting campaign:', err);
    }
  };

  const handleCancelCampaign = async (id: number) => {
    if (!confirm('Deseja pausar/interromper os disparos desta campanha?')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/campaigns/${id}/cancel`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchCampaigns();
      }
    } catch (err) {
      console.error('Error cancelling campaign:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans text-slate-800 antialiased">
      {/* Top Navbar */}
      <header className="bg-[#890038] border-b border-[#72002E] sticky top-0 z-40 shadow-xs">
        <div className="w-full max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl text-white tracking-wider">VERO</span>
              <span className="text-white/80 font-medium text-xs px-2 py-0.5 rounded bg-white/10 uppercase tracking-widest">Acordo AI</span>
            </div>
            <div className="h-5 w-[1px] bg-white/20 mx-2 hidden sm:block" />
            <h1 className="text-sm sm:text-base font-medium text-white/90 hidden md:block">
              Orquestrador de Voz IA & Negociação
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={handleSync}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg transition cursor-pointer"
            >
              <RefreshCw size={14} /> Sincronizar
            </button>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/70">Gateway:</span>
              <span className="flex items-center gap-1 font-semibold text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Dialog DDM
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex w-full max-w-[1720px] mx-auto">
        {/* Sidebar */}
        <aside className="w-60 border-r border-slate-200/80 bg-white/80 backdrop-blur-xs p-4 space-y-6 hidden md:block shrink-0">
          <div className="space-y-1">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition cursor-pointer ${activeTab === 'dashboard' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <BarChart2 size={16} /> Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('campaigns')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition cursor-pointer ${activeTab === 'campaigns' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Upload size={16} /> Campanhas / Upload
            </button>
            <button 
              onClick={() => setActiveTab('leads')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition cursor-pointer ${activeTab === 'leads' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Users size={16} /> Visualizador de Leads
            </button>
          </div>
        </aside>

        {/* Conteúdo Principal */}
        <div className="p-6 lg:p-8 flex-1 min-w-0 space-y-8">
          
          {/* TAB 1: DASHBOARD OPERACIONAL */}
          {activeTab === 'dashboard' && (() => {
            const isSpecificCampaign = selectedCampaignId !== 'all';
            const isDateFiltered = selectedDate && selectedDate !== 'all';
            const activeCampaign = isSpecificCampaign ? campaigns.find(c => c.id === selectedCampaignId) : null;

            const formattedDateLabel = isDateFiltered
              ? selectedDate.split('-').reverse().join('/')
              : 'Acumulado Geral';

            const totalDiscados = stats.total_processed || 0;
            const totalLeadsBase = stats.total_unique_leads || stats.total_leads || totalDiscados || 0;
            const totalAtendidas = stats.total_successful_calls || 0;
            const totalNaoAtendidas = stats.total_failed_calls || 0;

            const hitRate = totalDiscados > 0 ? (totalAtendidas / totalDiscados) * 100 : 0;

            // Paleta para as ocorrências
            const pieColors = ['#10B981', '#F43F5E', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B'];
            const tabulationPieData = occurrences.length > 0 
              ? occurrences.map((o, idx) => ({
                  name: o.occurrence || 'Não Identificado',
                  value: o.count,
                  color: pieColors[idx % pieColors.length]
                }))
              : [
                  { name: 'Atendidas', value: totalAtendidas, color: '#10B981' },
                  { name: 'Não Atendidas', value: totalNaoAtendidas, color: '#F43F5E' }
                ];

            return (
              <div className="w-full space-y-6">
                {/* Header & Filtros */}
                <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1">
                      <span>Painéis</span>
                      <span className="text-slate-300">/</span>
                      <span className="text-slate-700 font-medium">Dashboard Operacional</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Operação de Voz com IA</h1>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Disparador Ativo
                      </span>
                    </div>
                  </div>

                  {/* Filtros */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Campanha */}
                    <div className="flex items-center gap-2 bg-slate-50/90 px-3 py-2 rounded-lg border border-slate-200/80 shadow-2xs">
                      <span className="text-xs font-medium text-slate-500">Campanha:</span>
                      <select 
                        value={selectedCampaignId}
                        onChange={(e) => {
                          const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                          handleCampaignSelect(val);
                        }}
                        className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer max-w-[220px]"
                      >
                        <option value="all">Todas as Campanhas</option>
                        {campaigns.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Data */}
                    <div className="flex items-center gap-2 bg-slate-50/90 px-3 py-2 rounded-lg border border-slate-200/80 shadow-2xs">
                      <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                        <Calendar size={13} className="text-slate-400" /> Data:
                      </span>
                      <select 
                        value={selectedDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedDate(val);
                          fetchStats(selectedCampaignId, val);
                          fetchOccurrences(selectedCampaignId, val);
                          fetchHourlyStats(selectedCampaignId, startHour, endHour, val);
                        }}
                        className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                      >
                        <option value="all">📅 Todos os Dias</option>
                        <option value={todayIso}>
                          ⚡ Hoje ({new Date().toLocaleDateString('pt-BR')})
                        </option>
                        {availableDates
                          .filter(d => d.date_str !== todayIso)
                          .map(d => {
                            const [year, month, day] = d.date_str.split('-');
                            return (
                              <option key={d.date_str} value={d.date_str}>
                                📅 {day}/{month}/{year} ({d.total_processed} discagens)
                              </option>
                            );
                          })}
                      </select>
                    </div>

                    {/* Horário */}
                    <div className="flex items-center gap-2 bg-slate-50/90 px-3 py-2 rounded-lg border border-slate-200/80 shadow-2xs">
                      <span className="text-xs font-medium text-slate-500">Horário:</span>
                      <select 
                        value={startHour}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setStartHour(val);
                          fetchHourlyStats(selectedCampaignId, val, endHour, selectedDate);
                        }}
                        className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                      >
                        {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(h => (
                          <option key={h} value={h}>{h}h</option>
                        ))}
                      </select>
                      <span className="text-xs text-slate-400">às</span>
                      <select 
                        value={endHour}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setEndHour(val);
                          fetchHourlyStats(selectedCampaignId, startHour, val, selectedDate);
                        }}
                        className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                      >
                        {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => (
                          <option key={h} value={h}>{h}h</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* KPIs Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <ModernKPICard 
                    title="1. Base Total de Leads"
                    value={totalLeadsBase.toLocaleString('pt-BR')}
                    subtitle={isDateFiltered ? `Leads importados em ${formattedDateLabel}` : "Total de leads cadastrados"}
                    progress={100}
                    colorTheme="slate"
                    indicatorText="Mailing"
                  />
                  <ModernKPICard 
                    title="2. Volume Discado"
                    value={totalDiscados.toLocaleString('pt-BR')}
                    subtitle={`${(totalLeadsBase > 0 ? (totalDiscados / totalLeadsBase) * 100 : 0).toFixed(1)}% da base discada`}
                    progress={totalLeadsBase > 0 ? (totalDiscados / totalLeadsBase) * 100 : 0}
                    colorTheme="cyan"
                    indicatorText="Tentativas"
                  />
                  <ModernKPICard 
                    title="3. Taxa de Alô (Hit)"
                    value={`${hitRate.toFixed(2).replace('.', ',')}%`}
                    subtitle={`${totalAtendidas.toLocaleString('pt-BR')} conexões atendidas`}
                    progress={hitRate}
                    colorTheme="indigo"
                    indicatorText="Hit Rate"
                  />
                  <ModernKPICard 
                    title="4. Chamadas Atendidas"
                    value={totalAtendidas.toLocaleString('pt-BR')}
                    subtitle="Ligações completadas com áudio"
                    progress={hitRate}
                    colorTheme="emerald"
                    indicatorText="Conectadas"
                  />
                  <ModernKPICard 
                    title="5. Não Atendidas / Caixa"
                    value={totalNaoAtendidas.toLocaleString('pt-BR')}
                    subtitle="Ocupado, sem resposta ou caixa"
                    progress={totalDiscados > 0 ? (totalNaoAtendidas / totalDiscados) * 100 : 0}
                    colorTheme="rose"
                    indicatorText="Incompletas"
                  />
                </div>

                {/* Gráficos */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Gráfico de Barras por Horário */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] lg:col-span-2">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Volumetria de Discagens por Horário</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Distribuição horária das chamadas atendidas e não atendidas</p>
                      </div>
                    </div>
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                          <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={{ stroke: '#E2E8F0' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={{ stroke: '#E2E8F0' }} tickLine={false} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', fontSize: '12px' }} 
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '14px' }} iconType="circle" />
                          <Bar dataKey="atendeu" name="🟢 Atendidas (Alô)" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} barSize={28} />
                          <Bar dataKey="naoAtendeu" name="🔴 Não Atendeu / Caixa" stackId="a" fill="#F43F5E" radius={[4, 4, 0, 0]} barSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Gráfico Donut de Tabulações */}
                  <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] lg:col-span-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-semibold text-slate-900">Ocorrências da IA</h3>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200/60 tabular-nums">
                          {totalDiscados.toLocaleString('pt-BR')} Discados
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-4">Classificação e tabulações retornadas pelo agente</p>
                      <div className="h-[230px] w-full relative flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={tabulationPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={62}
                              outerRadius={88}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {tabulationPieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip 
                              contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: '10px', border: '1px solid #E2E8F0', fontSize: '12px' }} 
                            />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconType="circle" />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tabela de Horários */}
                <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.03)] overflow-hidden">
                  <div className="border-b border-slate-200/80 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Detalhamento por Hora</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Métricas de ligações concluídas ao longo do dia</p>
                    </div>

                    {activeCampaign && (
                      <div className="flex items-center gap-2">
                        {activeCampaign.status === 'processing' ? (
                          <button 
                            onClick={() => handleCancelCampaign(activeCampaign.id)}
                            className="px-3 py-1.5 border border-amber-300 text-amber-700 bg-amber-50 rounded-lg text-xs font-semibold hover:bg-amber-100 transition flex items-center gap-1.5"
                          >
                            ⏸️ Pausar Discagem
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleStartCampaign(activeCampaign.id)}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition flex items-center gap-1.5"
                          >
                            <Play size={13} />
                            {activeCampaign.status === 'pending' ? 'Iniciar Discagem' : 'Continuar Discagem'}
                          </button>
                        )}
                        <a 
                          href={`${BACKEND_URL}/api/campaigns/${activeCampaign.id}/export?filter=answered`}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition flex items-center gap-1.5"
                        >
                          <Download size={13} />
                          Exportar Atendidas
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="p-6">
                    <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
                      <table className="w-full text-left text-xs text-slate-600">
                        <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200/80 text-[11px]">
                          <tr>
                            <th className="py-3 px-4">Status</th>
                            {hourlyData.map(h => (
                              <th key={h.hour} className="py-3 px-2.5 text-center">{h.hour}</th>
                            ))}
                            <th className="py-3 px-4 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                          <tr className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-emerald-700">🟢 ATENDIDAS</td>
                            {hourlyData.map(h => (
                              <td key={h.hour} className="py-2.5 px-2.5 text-center text-slate-700 font-medium">{h.atendeu.toLocaleString('pt-BR')}</td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-bold text-emerald-700">{totalAtendidas.toLocaleString('pt-BR')}</td>
                          </tr>
                          <tr className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-4 font-medium text-rose-700">🔴 NÃO ATENDEU</td>
                            {hourlyData.map(h => (
                              <td key={h.hour} className="py-2.5 px-2.5 text-center text-slate-600">{h.naoAtendeu.toLocaleString('pt-BR')}</td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-bold text-rose-700">{totalNaoAtendidas.toLocaleString('pt-BR')}</td>
                          </tr>
                        </tbody>
                        <tfoot className="bg-slate-50/90 font-semibold border-t-2 border-slate-200 text-slate-900 text-[11px] tabular-nums">
                          <tr>
                            <td className="py-3 px-4 uppercase tracking-wider">Total Discado</td>
                            {hourlyData.map(h => (
                              <td key={h.hour} className="py-3 px-2.5 text-center font-bold">{h.discados.toLocaleString('pt-BR')}</td>
                            ))}
                            <td className="py-3 px-4 text-right font-bold text-slate-900">{totalDiscados.toLocaleString('pt-BR')}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
            );
          })()}

          {/* TAB 2: CAMPANHAS / UPLOAD */}
          {activeTab === 'campaigns' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Form de Upload */}
              <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm h-fit">
                <h3 className="text-base font-bold text-slate-800 mb-6">Importar Mailing / Nova Campanha</h3>
                <form onSubmit={handleFileUpload} className="space-y-6">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Nome da Campanha
                    </label>
                    <input 
                      type="text" 
                      placeholder="Ex: Campanha Acordo Vero 01"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#890038]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Discador / Gateway
                    </label>
                    <input 
                      type="text" 
                      value="Dialog DDM Voice AI (MeuDiscador)"
                      disabled
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 font-semibold text-slate-700 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      ID do Assistente / Agente IA (Dialog DDM)
                    </label>
                    <input 
                      type="text" 
                      placeholder="Ex: 5"
                      value={assistantId}
                      onChange={(e) => setAssistantId(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#890038]"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Informe o ID do agente que você criou no painel do Dialog.
                    </span>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Linha / Tronco Telefônico (BINA)
                    </label>
                    <input 
                      type="text" 
                      placeholder="Ex: oktor_sip_500ch"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#890038]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Planilha de Leads (.XLSX, .CSV)
                    </label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-[#890038] transition cursor-pointer bg-slate-50 flex flex-col items-center justify-center space-y-2"
                    >
                      <UploadCloud size={32} className="text-slate-400" />
                      <span className="text-xs text-slate-600 font-semibold block">
                        {file ? file.name : 'Clique para selecionar a planilha'}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        Colunas recomendadas: Nome, Telefone, CPF
                      </span>
                      <input 
                        ref={fileInputRef}
                        type="file" 
                        accept=".xlsx,.xls,.csv"
                        className="hidden" 
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            setFile(e.target.files[0]);
                          }
                        }}
                      />
                    </div>
                  </div>

                  {uploadError && (
                    <div className="bg-red-50 text-red-700 text-xs p-3 rounded-lg border border-red-100 flex items-start gap-2">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {uploadSuccess && (
                    <div className="bg-green-50 text-green-700 text-xs p-3 rounded-lg border border-green-100 flex items-start gap-2">
                      <CheckCircle2 size={16} className="shrink-0" />
                      <span>{uploadSuccess}</span>
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={uploading}
                    className="w-full bg-[#890038] text-white py-3 rounded-lg text-sm font-semibold hover:bg-[#72002E] disabled:bg-slate-300 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <UploadCloud size={16} />
                    {uploading ? 'Importando Leads...' : 'Criar Campanha e Iniciar'}
                  </button>
                </form>
              </div>

              {/* Lista das Campanhas */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm lg:col-span-2 space-y-4">
                <h3 className="text-base font-bold text-slate-800">Campanhas Criadas</h3>
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                  {campaigns.length > 0 ? (
                    campaigns.map(c => {
                      const isSelected = selectedCampaignId === c.id;
                      const pct = c.total_leads > 0 ? Math.round((c.processed_leads / c.total_leads) * 100) : 0;
                      return (
                        <div 
                          key={c.id} 
                          className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between md:flex-row md:items-center gap-4 ${
                            isSelected ? 'border-[#890038] bg-rose-50/20' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                          onClick={() => handleCampaignSelect(c.id)}
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-3">
                              <h4 className="font-bold text-sm text-slate-700">{c.name}</h4>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                c.status === 'completed' && 'bg-green-50 text-green-700 border border-green-200'
                              } ${
                                c.status === 'processing' && 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                              } ${
                                c.status === 'pending' && 'bg-slate-50 text-slate-600 border border-slate-200'
                              }`}>
                                {c.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 flex items-center gap-4">
                              <span>Total: <strong>{c.total_leads}</strong> leads</span>
                              <span>Discados: <strong>{c.processed_leads}</strong></span>
                              <span>Atendidas: <strong className="text-emerald-600">{c.successful_calls}</strong></span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-[#890038] h-full rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {c.status === 'processing' ? (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleCancelCampaign(c.id); }}
                                className="px-3 py-1.5 border border-amber-300 text-amber-700 bg-amber-50 rounded-lg text-xs font-semibold hover:bg-amber-100 transition"
                              >
                                Pausar
                              </button>
                            ) : (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleStartCampaign(c.id); }}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition flex items-center gap-1"
                              >
                                <Play size={12} /> Continuar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-400 py-6 text-center">Nenhuma campanha cadastrada ainda.</p>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: VISUALIZADOR DE LEADS */}
          {activeTab === 'leads' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Visualizador de Leads</h3>
                  <p className="text-xs text-slate-400">Leads discados com transcrição completa e gravação em áudio</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Buscar por Nome, Telefone ou CPF..."
                      value={searchTerm}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSearchTerm(val);
                        setLeadsPage(1);
                        fetchLeads(selectedCampaignId, 1, statusFilter, val);
                      }}
                      className="pl-9 pr-4 py-1.5 border border-slate-200 rounded-lg text-xs w-64 focus:outline-none focus:border-[#890038]"
                    />
                  </div>
                  <select 
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setLeadsPage(1);
                      fetchLeads(selectedCampaignId, 1, e.target.value, searchTerm);
                    }}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-transparent focus:outline-none"
                  >
                    <option value="all">Todos os Status</option>
                    <option value="completed">Atendidas</option>
                    <option value="failed">Não Atendidas</option>
                    <option value="calling">Chamando</option>
                    <option value="pending">Pendentes</option>
                  </select>
                </div>
              </div>

              {/* Tabela */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200/80">
                    <tr>
                      <th className="py-3 px-4">Nome do Cliente</th>
                      <th className="py-3 px-4">Telefone</th>
                      <th className="py-3 px-4">CPF</th>
                      <th className="py-3 px-4">Status da Chamada</th>
                      <th className="py-3 px-4">Duração</th>
                      <th className="py-3 px-4">Ocorrência (Tabulação)</th>
                      <th className="py-3 px-4">Gravação</th>
                      <th className="py-3 px-4">Diálogo (IA)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.length > 0 ? (
                      leads.map(l => (
                        <tr key={l.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-800">{l.name}</td>
                          <td className="py-3 px-4">{l.phone}</td>
                          <td className="py-3 px-4 text-slate-500">{l.cpf || '-'}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              l.call_status === 'completed' && 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            } ${
                              l.call_status === 'calling' && 'bg-sky-50 text-sky-700 border border-sky-200 animate-pulse'
                            } ${
                              l.call_status === 'failed' && 'bg-rose-50 text-rose-700 border border-rose-200'
                            } ${
                              l.call_status === 'pending' && 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}>
                              {l.call_status === 'completed' ? 'Atendida' : (l.call_status === 'calling' ? 'Chamando' : (l.call_status === 'failed' ? 'Não Atendeu' : 'Pendente'))}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {l.call_duration ? `${l.call_duration}s` : '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px] border border-slate-200">
                              {l.occurrence || (l.call_status === 'completed' ? 'ATENDIDA' : (l.call_status === 'failed' ? 'NÃO ATENDEU' : 'PENDENTE'))}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {l.recording_url ? (
                              <audio 
                                controls 
                                src={l.recording_url} 
                                className="h-7 w-36"
                              />
                            ) : (
                              <span className="text-slate-300 text-[10px] italic">Sem áudio</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {(l.transcript || l.call_id) ? (
                              <button 
                                onClick={() => handleOpenTranscriptModal(l)}
                                className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold hover:bg-indigo-100 transition flex items-center gap-1 cursor-pointer"
                              >
                                <MessageSquare size={12} />
                                Transcrição
                              </button>
                            ) : (
                              <span className="text-slate-300 text-[10px] italic">Sem texto</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Nenhum lead encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
                <span className="text-slate-400">
                  Total de leads: <strong>{leadsTotalCount}</strong> (Página {leadsPage} de {leadsTotalPages || 1})
                </span>
                <div className="flex items-center gap-2">
                  <button 
                    disabled={leadsPage === 1}
                    onClick={() => { setLeadsPage(p => p - 1); fetchLeads(selectedCampaignId, leadsPage - 1, statusFilter, searchTerm); }}
                    className="p-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button 
                    disabled={leadsPage >= leadsTotalPages}
                    onClick={() => { setLeadsPage(p => p + 1); fetchLeads(selectedCampaignId, leadsPage + 1, statusFilter, searchTerm); }}
                    className="p-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal de Transcrição e Gravação */}
      {selectedTranscriptLead && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#890038]/10 text-[#890038] flex items-center justify-center">
                  <PhoneCall size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{selectedTranscriptLead.name}</h3>
                  <p className="text-xs text-slate-400">{selectedTranscriptLead.phone} | Duração: {selectedTranscriptLead.call_duration || 0}s</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedTranscriptLead(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Gravação se houver */}
            {selectedTranscriptLead.recording_url && (
              <div className="bg-indigo-50/50 border-b border-indigo-100 px-6 py-3 flex items-center gap-3">
                <Volume2 size={16} className="text-indigo-600 shrink-0" />
                <span className="text-xs font-semibold text-indigo-900 shrink-0">Áudio da Gravação:</span>
                <audio controls src={selectedTranscriptLead.recording_url} className="h-8 flex-1" />
              </div>
            )}

            {/* Conteúdo do Diálogo */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 bg-slate-50/30">
              <div className="space-y-3">
                {cleanDisplayTranscript(selectedTranscriptLead.transcript)
                  .split('\n')
                  .filter(line => line.trim().length > 0)
                  .map((line, idx) => {
                    const isAgent = line.startsWith('Agente:') || line.startsWith('Vero:');
                    const isClient = line.startsWith('Cliente:');
                    const text = line.replace(/^(Agente|Vero|Cliente|Assistente|Bot|User):/i, '').trim();

                    return (
                      <div 
                        key={idx} 
                        className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                      >
                        <span className="text-[10px] font-bold text-slate-400 mb-1 px-1">
                          {isAgent ? 'Agente de Voz IA' : (isClient ? selectedTranscriptLead.name : 'Interlocutor')}
                        </span>
                        <div 
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs ${
                            isAgent 
                              ? 'bg-white border border-slate-200 text-slate-800 shadow-2xs' 
                              : 'bg-[#890038] text-white shadow-2xs'
                          }`}
                        >
                          {text || line}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => setSelectedTranscriptLead(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
