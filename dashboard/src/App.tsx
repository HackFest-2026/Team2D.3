import { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from 'recharts';
import { AlertCircle, ShieldAlert, CheckCircle2, Play, Square, RefreshCcw, Activity, Clock, FileWarning, FileCheck2, Loader2, ShieldCheck, ChevronRight, Radio, Terminal, Zap } from 'lucide-react';
import { format } from 'date-fns';

const API_URL = 'http://127.0.0.1:8000';
const WS_URL = 'ws://127.0.0.1:8000/ws/incidents';
const API_TOKEN = import.meta.env.VITE_AGENT_TOKEN;
void WS_URL;
if (!API_TOKEN) throw new Error('Missing VITE_AGENT_TOKEN');

type ActionStatus = 'pending' | 'delivered' | 'complete' | 'failed';
type ActionType = 'terminate' | 'resume' | 'restore';
interface Action { id: string; type: ActionType; status: ActionStatus; }
interface IncidentEvent { id: string; timestamp: string; score: number; signal_contributions?: Record<string, number>; }
interface Reason { reason: string; }
interface Incident {
  id: string; pid: number | null; process_name: string; cmdline: string[]; create_time: number;
  status: string; max_score: number; start_time: string; contained_after_ms: number | null;
  affected_count: number; restored_count: number; events?: IncidentEvent[]; reasons?: Reason[]; actions?: Action[];
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { cls: string; icon: React.ReactNode }> = {
    Alert:             { cls: 'status-neutral', icon: <AlertCircle /> },
    'Suspend-Pending': { cls: 'status-pending', icon: <Loader2 /> },
    Suspended:         { cls: 'status-danger',  icon: <ShieldAlert /> },
    'Terminate-Pending':{ cls: 'status-pending', icon: <Loader2 /> },
    Terminated:        { cls: 'status-danger',  icon: <Square /> },
    Restored:          { cls: 'status-ok',      icon: <CheckCircle2 /> },
    Resumed:           { cls: 'status-neutral', icon: <Play /> },
    Failed:            { cls: 'status-danger',  icon: <AlertCircle /> },
  };
  const item = config[status] ?? { cls: 'status-neutral', icon: <AlertCircle /> };
  return <span className={`status-pill ${item.cls}`}>{item.icon}<span>{status}</span></span>;
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const isHigh = score >= 70;
  return (
    <div className="score-gauge" aria-label={`Threat score ${score.toFixed(0)} of 100`}>
      <svg viewBox="0 0 104 104" role="img" aria-hidden="true">
        <circle className="gauge-track" cx="52" cy="52" r={radius} />
        <circle
          className={`gauge-value${isHigh ? ' high' : ''}`}
          cx="52" cy="52" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(score, 100) / 100)}
        />
        {[40, 70, 90].map((n) => (
          <line key={n} className={`gauge-marker marker-${n}`}
            x1="52" y1="4" x2="52" y2="10"
            transform={`rotate(${n * 3.6} 52 52)`} />
        ))}
      </svg>
      <div className="gauge-label">
        <strong>{score.toFixed(0)}</strong>
        <span>RISK SCORE</span>
      </div>
    </div>
  );
}

export default function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'connected' | 'disconnected' | 'polling'>('disconnected');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  void wsRef; void reconnectDelayRef; void reconnectTimerRef;
  const isMockRef = useRef(isMock);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { isMockRef.current = isMock; }, [isMock]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const prevIncidentCountRef = useRef<number>(0);

  const fetchIncidents = useCallback(async () => {
    if (isMockRef.current) return;
    try {
      const res = await fetch(`${API_URL}/api/incidents`, { headers: { 'x-agent-token': API_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        // Sort newest incidents first by start_time
        const sorted = [...data].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

        // Always auto-select the latest incident if none is selected yet, or when a new attack arrives
        if (sorted.length > 0) {
          const newest = sorted[0];
          if (!selectedIdRef.current || sorted.length !== prevIncidentCountRef.current) {
            setSelectedId(newest.id);
            fetchIncidentDetails(newest.id);
            prevIncidentCountRef.current = sorted.length;
          }
        }

        setIncidents(prev => {
          const next = sorted.map((n: any) => { const e = prev.find(p => p.id === n.id); return e ? { ...e, ...n } : n; });
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
    } catch { /* backend may be down */ }
  }, []);

  const fetchIncidentDetails = useCallback(async (id: string) => {
    if (isMockRef.current) return;
    try {
      const res = await fetch(`${API_URL}/api/incidents/${id}`, { headers: { 'x-agent-token': API_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        setIncidents(prev => { const next = prev.map(i => i.id === id ? { ...i, ...data } : i); return JSON.stringify(prev) === JSON.stringify(next) ? prev : next; });
      }
    } catch { /* silently handle */ }
  }, []);

  useEffect(() => {
    if (isMock) {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      setBackendStatus('connected');
      setSelectedId('mock-1');
      setIncidents([{
        id: 'mock-1', pid: 4821, process_name: 'ransomware.exe',
        cmdline: ['ransomware.exe', '--encrypt', '--silent'],
        create_time: Date.now() / 1000,
        status: 'Restored', max_score: 98, start_time: new Date().toISOString(),
        contained_after_ms: 2340, affected_count: 87, restored_count: 87,
        events: Array.from({ length: 12 }).map((_, i) => ({
          id: `ev-${i}`, timestamp: new Date(Date.now() - (12 - i) * 5000).toISOString(),
          score: Math.min(100, i * 9 + Math.random() * 4),
          signal_contributions: { renames: 10, entropy: 14, write_rate: 10, ransomware_combo: 45, script_host: 10 }
        })),
        reasons: [
          { reason: 'rename + extension change + high entropy together, typical of ransomware' },
          { reason: '218 files renamed in 5 s' },
          { reason: 'write entropy 7.9, typical of encrypted data' },
        ],
        actions: [{ id: 'a1', type: 'terminate', status: 'complete' }, { id: 'a2', type: 'restore', status: 'complete' }]
      }]);
      return;
    }
    const doPoll = async () => {
      try {
        await fetchIncidents();
        setBackendStatus('connected');
        if (selectedIdRef.current) await fetchIncidentDetails(selectedIdRef.current);
      }
      catch { setBackendStatus('disconnected'); }
    };
    doPoll();
    // High-frequency 500ms polling for instant real-time reactions during attack floods
    pollTimerRef.current = window.setInterval(doPoll, 500);
    return () => { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } };
  }, [isMock, fetchIncidents, fetchIncidentDetails]);

  const triggerAction = async (id: string, type: ActionType) => {
    if (isMock) return;
    setActionLoading(`${id}-${type}`);
    try {
      const res = await fetch(`${API_URL}/api/incidents/${id}/actions`, {
        method: 'POST',
        headers: { 'x-agent-token': API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      if (res.status === 409) { /* already exists */ }
      await fetchIncidentDetails(id);
    } catch { /* silently handle */ }
    finally { setActionLoading(null); setConfirmTerminate(false); }
  };

  const totalIncidents = incidents.length;
  const ttdValues = incidents.filter(i => i.contained_after_ms != null && i.contained_after_ms > 0);
  const ttdAvg = ttdValues.length > 0 ? ttdValues.reduce((acc, i) => acc + (i.contained_after_ms ?? 0), 0) / ttdValues.length : 0;
  const totalFilesAffected = incidents.reduce((acc, i) => acc + Math.max(i.affected_count ?? 0, i.restored_count ?? 0), 0);
  const totalRestored = incidents.reduce((acc, i) => acc + i.restored_count, 0);
  const selected = incidents.find(i => i.id === selectedId);
  const canResume   = selected?.status === 'Suspended';
  const canTerminate = selected?.status === 'Suspended' || selected?.status === 'Resumed';
  const canRestore  = selected?.status === 'Terminated' && (selected?.restored_count ?? 0) === 0;
  const hasPendingAction = (type: ActionType) => selected?.actions?.some(a => a.type === type && (a.status === 'pending' || a.status === 'delivered')) ?? false;
  const activeThreat = incidents.some(i => ['Suspended', 'Terminated', 'Failed'].includes(i.status));
  const restoredPercent = selected && Math.max(selected.affected_count ?? 0, selected.restored_count ?? 0) > 0
    ? Math.min(100, selected.restored_count / Math.max(selected.affected_count ?? 0, selected.restored_count ?? 0) * 100) : 0;
  const events  = selected?.events?.slice().reverse() ?? [];
  const signals = selected?.events?.[0]?.signal_contributions
    ? Object.entries(selected.events[0].signal_contributions)
        .filter(([k, v]) => k !== 'total' && v > 0)
        .map(([name, value]) => ({ name: name.replaceAll('_', ' '), value }))
    : [];

  return (
    <main className={`app-shell${activeThreat ? ' has-threat' : ''}`}>
      {/* ── Accent bar ── */}
      <div className="top-bar" />

      {/* ── Header ── */}
      <header className="masthead enter">
        <a className="brand" href="#top" aria-label="SentinelAI home">
          <div className="brand-icon"><Zap size={18} /></div>
          <div className="brand-text">
            <span className="brand-name">SENTINEL<em>AI</em></span>
            <span className="brand-sub">Endpoint Defense · Incident Room</span>
          </div>
        </a>
        <div className="header-right">
          <label className="mock-toggle">
            <input type="checkbox" checked={isMock} onChange={e => setIsMock(e.target.checked)} />
            <span className="toggle-track" />
            <span>Demo</span>
          </label>
          <div className="connection">
            <span className={`connection-dot ${backendStatus}`} />
            <span>
              {backendStatus === 'connected'
                ? `Live · ${incidents.length > 0 ? '1' : '3'}s sync`
                : backendStatus === 'polling' ? 'Syncing…' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <div className="content">

        {/* ── Intro row ── */}
        <div className="intro-row enter" style={{ animationDelay: '.06s' }}>
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /><Radio size={11} /> Protection Overview</div>
            <h1 className="intro-title">Threats, <span>neutralised.</span></h1>
            <p className="intro-sub">Real-time ransomware detection, containment, and file recovery.</p>
          </div>
          <div className="today-stamp">
            <span>Operator Console</span>
            <strong>{format(new Date(), 'dd MMM yyyy')}</strong>
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div className="stats-grid enter" style={{ animationDelay: '.1s' }}>
          {/* Primary — MTTC */}
          <div className="stat-card primary">
            <div className="stat-label">
              Mean Time to Contain
              <span className="stat-icon"><Clock size={15} /></span>
            </div>
            <div className="stat-value">
              {ttdAvg > 0 ? <>{(ttdAvg / 1000).toFixed(1)}<small>s</small></> : <>—<small> s</small></>}
            </div>
            <div className="stat-sub">
              <span className="stat-sub-dot" />
              Alert <ChevronRight size={10} /> Contained &nbsp;·&nbsp; <b style={{ color: '#6b7280' }}>{ttdValues.length} case{ttdValues.length === 1 ? '' : 's'}</b>
            </div>
          </div>

          {/* Incidents */}
          <div className="stat-card stat-card-sm">
            <div className="stat-label">Incidents<span className="stat-icon"><Activity size={14} /></span></div>
            <div className="stat-value-sm">{totalIncidents.toString().padStart(2, '0')}</div>
            <div className="stat-foot"><Activity size={12} />This session</div>
          </div>

          {/* Files at risk */}
          <div className="stat-card stat-card-sm">
            <div className="stat-label">Files at Risk<span className="stat-icon"><FileWarning size={14} /></span></div>
            <div className="stat-value-sm">{totalFilesAffected.toString().padStart(2, '0')}</div>
            <div className="stat-foot"><FileWarning size={12} />Identified</div>
          </div>

          {/* Files recovered */}
          <div className="stat-card stat-card-sm">
            <div className="stat-label">Recovered<span className="stat-icon"><FileCheck2 size={14} /></span></div>
            <div className="stat-value-sm ok">{totalRestored.toString().padStart(2, '0')}</div>
            <div className="stat-foot"><FileCheck2 size={12} />Returned safely</div>
          </div>
        </div>

        {/* ── Workspace ── */}
        <div className="workspace enter" style={{ animationDelay: '.16s' }}>

          {/* ── Case list ── */}
          <div className="case-column panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" />Case Register</div>
                <h2>Incidents <sup>{totalIncidents}</sup></h2>
              </div>
              <div className="heading-badge"><span className="live-dot" />Newest first</div>
            </div>

            {incidents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><ShieldCheck size={26} /></div>
                <h3>All Clear</h3>
                <p>No ransomware behaviour detected. Monitoring file activity in real time.</p>
                <div className="monitor-badge"><span className="connection-dot connected" />Monitoring Active</div>
              </div>
            ) : (
              <div className="case-list" role="list">
                {incidents.map((inc, idx) => (
                  <button
                    type="button" role="listitem" key={inc.id}
                    onClick={() => { setSelectedId(inc.id); setConfirmTerminate(false); fetchIncidentDetails(inc.id); }}
                    className={`case-row${selectedId === inc.id ? ' selected' : ''}${['Suspended','Terminated','Failed'].includes(inc.status) ? ' row-danger' : ''}`}
                    style={{ animationDelay: `${idx * 45}ms` }}
                  >
                    <span className="case-time">
                      {format(new Date(inc.start_time), 'HH:mm:ss')}
                      <small>{format(new Date(inc.start_time), 'dd MMM')}</small>
                    </span>
                    <span className="case-main">
                      <strong>{inc.process_name}</strong>
                      <small>PID {inc.pid ?? 'N/A'} · {inc.cmdline?.[1] ?? 'process activity'}</small>
                    </span>
                    <span className="case-score">
                      <b>{inc.max_score.toFixed(0)}</b>
                      <small>RISK</small>
                    </span>
                    <StatusPill status={inc.status} />
                  </button>
                ))}
              </div>
            )}

            <div className="list-footer">
              <span><span className="legend-dot danger" />Threat</span>
              <span><span className="legend-dot accent" />Monitored</span>
              <span><span className="legend-dot ok" />Recovered</span>
            </div>
          </div>

          {/* ── Detail panel ── */}
          <div className={`detail-column panel${selected && ['Suspended','Terminated','Failed'].includes(selected.status) ? ' detail-threat' : ''}`}>
            {!selected ? (
              <div className="detail-placeholder">
                <div className="placeholder-icon"><Activity size={22} /></div>
                <h3>Select an incident</h3>
                <p>Detection signals, containment timeline, and recovery actions will appear here.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="detail-header">
                  <div>
                    <div className="eyebrow">
                      <span className="eyebrow-dot" />Incident Dossier
                      <span className="dossier-id">/ {selected.id.slice(0,8).toUpperCase()}</span>
                    </div>
                    <h2>{selected.process_name}</h2>
                    <span className="process-meta">PID {selected.pid ?? 'N/A'}<span>·</span>{format(new Date(selected.start_time), 'dd MMM yyyy, HH:mm:ss')}</span>
                  </div>
                  <StatusPill status={selected.status} />
                </div>

                {selected.cmdline?.length > 0 && (
                  <div className="command-line">
                    <Terminal size={12} />
                    <code>{selected.cmdline.join(' ')}</code>
                  </div>
                )}

                {/* Score + tiers + time-to-contain */}
                <div className="incident-summary">
                  <ScoreGauge score={selected.max_score} />
                  <div className="tier-legend">
                    <div className="eyebrow"><span className="eyebrow-dot" />Thresholds</div>
                    <div><i className="tier-line alert-tier" /><b>40</b><span>Alert</span></div>
                    <div><i className="tier-line suspend-tier" /><b>70</b><span>Suspend</span></div>
                    <div><i className="tier-line terminate-tier" /><b>90</b><span>Terminate</span></div>
                  </div>
                  <div className="mini-result">
                    <div className="eyebrow"><span className="eyebrow-dot" />Contained in</div>
                    <strong>
                      {selected.contained_after_ms != null && selected.contained_after_ms > 0
                        ? (selected.contained_after_ms / 1000).toFixed(2)
                        : '—'}
                      <small>{selected.contained_after_ms != null && selected.contained_after_ms > 0 ? 's' : ''}</small>
                    </strong>
                    <span>From first alert</span>
                  </div>
                </div>

                {/* Timeline */}
                <section className="timeline-section">
                  <div className="section-label">
                    <span className="eyebrow"><span className="eyebrow-dot" />Response Timeline</span>
                    <span>{selected.contained_after_ms != null && selected.contained_after_ms > 0 ? `${(selected.contained_after_ms / 1000).toFixed(2)}s to contain` : 'Live observation'}</span>
                  </div>
                  <div className="timeline-track">
                    <div className="timeline-progress" style={{ width: selected.restored_count > 0 ? '100%' : selected.max_score >= 70 ? '66%' : selected.max_score >= 40 ? '33%' : '0%' }} />
                    <div className="timeline-step"><i className="step-dot detected" /><b>Detected</b><small>{selected.events?.[0] ? format(new Date(selected.events[0].timestamp), 'HH:mm:ss') : format(new Date(selected.start_time), 'HH:mm:ss')}</small></div>
                    <div className="timeline-step"><i className={`step-dot${selected.max_score >= 40 ? ' reached' : ''}`} /><b>Alert</b><small>Score ≥ 40</small></div>
                    <div className="timeline-step"><i className={`step-dot${selected.max_score >= 70 ? ' reached' : ''}`} /><b>Contained</b><small>{selected.status.includes('Pending') ? 'Awaiting…' : selected.status}</small></div>
                    <div className="timeline-step"><i className={`step-dot${selected.restored_count > 0 ? ' recovered' : ''}`} /><b>Recovered</b><small>{selected.restored_count > 0 ? 'Files returned' : 'Awaiting restore'}</small></div>
                  </div>
                </section>

                {/* Recovery bar */}
                <section className="recovery-section">
                  <div className="recovery-band">
                    <div className="recovery-copy">
                      <div>
                        <span>Blast radius / recovery</span>
                        <strong>{selected.restored_count}<small> / {Math.max(selected.affected_count ?? 0, selected.restored_count ?? 0)} files</small></strong>
                      </div>
                      <span className="recovery-percent">{restoredPercent.toFixed(0)}% restored</span>
                    </div>
                    <div className="recovery-track"><span style={{ width: `${restoredPercent}%` }} /></div>
                  </div>
                </section>

                {/* Why flagged */}
                {selected.reasons?.length ? (
                  <section className="signals-section">
                    <div className="eyebrow" style={{ marginBottom: '8px' }}><span className="eyebrow-dot" />Why it was flagged</div>
                    {selected.reasons.map(r => (
                      <div className="signal-note" key={r.reason}>
                        <AlertCircle size={15} />
                        <p>{r.reason}<small>MITRE ATT&amp;CK · T1486 Data Encrypted for Impact</small></p>
                      </div>
                    ))}
                  </section>
                ) : null}

                {/* Score chart */}
                {events.length > 0 && (
                  <section className="chart-section">
                    <div className="section-label">
                      <span className="eyebrow"><span className="eyebrow-dot" />Behavioural Score</span>
                      <span>0 – 100 · Recent signals</span>
                    </div>
                    <div className="chart-box">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={events} margin={{ top: 12, right: 8, bottom: 0, left: -24 }}>
                          <XAxis dataKey="timestamp" tickFormatter={t => format(new Date(t), 'HH:mm:ss')} tick={{ fill: '#374151', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 100]} ticks={[0, 40, 70, 90, 100]} tick={{ fill: '#374151', fontSize: 9 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ background: '#111318', border: '1px solid #2a2f3d', borderRadius: 8, color: '#e8eaf0', fontSize: 11 }} labelFormatter={v => format(new Date(String(v)), 'HH:mm:ss')} formatter={v => [`${v} / 100`, 'Risk score']} />
                          <ReferenceLine y={40} stroke="#6366f1" strokeDasharray="3 4" strokeOpacity={.5} />
                          <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="3 4" strokeOpacity={.6} />
                          <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="3 4" />
                          <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#818cf8', stroke: '#0a0c10', strokeWidth: 2 }} isAnimationActive />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="chart-thresholds"><span>40 Alert</span><span>70 Suspend</span><span>90 Terminate</span></div>
                    </div>
                  </section>
                )}

                {/* Signal bars */}
                {signals.length > 0 && (
                  <section className="chart-section signal-chart">
                    <div className="section-label">
                      <span className="eyebrow"><span className="eyebrow-dot" />Signal Contributions</span>
                      <span>Weighted evidence</span>
                    </div>
                    <div className="chart-box">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={signals} layout="vertical" margin={{ top: 2, right: 24, bottom: 0, left: 4 }}>
                          <XAxis type="number" hide domain={[0, 'dataMax + 10']} />
                          <YAxis dataKey="name" type="category" width={110} tick={{ fill: '#4b5563', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: '#181b22' }} contentStyle={{ background: '#111318', border: '1px solid #2a2f3d', borderRadius: 8, fontSize: 11, color: '#e8eaf0' }} formatter={v => [`${v} pts`, 'Contribution']} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={9} isAnimationActive>
                            {signals.map((item, i) => <Cell key={item.name} fill={i === 0 ? '#6366f1' : '#2a2f3d'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                )}

                {/* Operator controls */}
                <section className="actions-section">
                  <div className="section-label">
                    <span className="eyebrow"><span className="eyebrow-dot" />Operator Controls</span>
                    <span>Actions are audited</span>
                  </div>
                  <div className="action-buttons">
                    <button type="button"
                      onClick={() => triggerAction(selected.id, 'resume')}
                      disabled={!canResume || hasPendingAction('resume') || actionLoading !== null}
                      className="action-button resume-button">
                      {actionLoading === `${selected.id}-resume` || hasPendingAction('resume') ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
                      {hasPendingAction('resume') ? 'Pending' : 'Resume'}
                    </button>
                    <button type="button"
                      onClick={() => confirmTerminate ? triggerAction(selected.id, 'terminate') : setConfirmTerminate(true)}
                      disabled={!canTerminate || hasPendingAction('terminate') || actionLoading !== null}
                      className={`action-button terminate-button${confirmTerminate ? ' confirming' : ''}`}>
                      {actionLoading === `${selected.id}-terminate` || hasPendingAction('terminate') ? <Loader2 className="spin" size={13} /> : <Square size={12} />}
                      {hasPendingAction('terminate') ? 'Pending' : confirmTerminate ? 'Confirm Terminate' : 'Terminate'}
                    </button>
                    <button type="button"
                      onClick={() => triggerAction(selected.id, 'restore')}
                      disabled={!canRestore || hasPendingAction('restore') || actionLoading !== null}
                      className="action-button restore-button">
                      {actionLoading === `${selected.id}-restore` || hasPendingAction('restore') ? <Loader2 className="spin" size={13} /> : <RefreshCcw size={13} />}
                      {hasPendingAction('restore') ? 'Pending' : 'Restore Files'}
                    </button>
                  </div>
                  {confirmTerminate && (
                    <div className="confirm-note" role="status">
                      Terminate this process? Click "Confirm Terminate" again to send the audited action.
                      <button type="button" onClick={() => setConfirmTerminate(false)}>Cancel</button>
                    </div>
                  )}
                  {selected.actions?.length ? (
                    <div className="action-history">
                      {selected.actions.map(action => (
                        <div className="history-row" key={action.id}>
                          <span>{action.type} requested</span>
                          <span className={action.status === 'complete' ? 'history-ok' : action.status === 'failed' ? 'history-failed' : 'history-pending'}>
                            {action.status === 'complete' && <CheckCircle2 size={12} />}
                            {(action.status === 'pending' || action.status === 'delivered') && <Loader2 className="spin" size={12} />}
                            {action.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="page-footer">
        <span>SENTINEL<em>AI</em> <span className="footer-dot" /> Endpoint Ransomware Defense</span>
        <span>Detect <span className="footer-dot" /> Contain <span className="footer-dot" /> Restore</span>
      </footer>
    </main>
  );
}
