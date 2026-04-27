import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Database, Folder, MessageSquare, BarChart2, TrendingUp, Menu, Zap, CircleDot, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend, LineChart, Line, ComposedChart
} from 'recharts';

/**
 * Custom SOTA Tooltip for Recharts
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '16px',
        boxShadow: 'var(--shadow-lg)',
        color: 'var(--text)',
        minWidth: '200px'
      }}>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          {new Date(label).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {payload.map((entry, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, boxShadow: `0 0 8px ${entry.color}88` }} />
                <span style={{ color: 'var(--text-3)' }}>
                  {entry.name === 'documents' ? 'Docs Ingested' : entry.name === 'messages' ? 'Messages Sent' : entry.name === 'cumulative' ? 'Total Docs' : entry.name}
                </span>
              </div>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function ActivityPage({ isMobile, onOpenMobileMenu }) {
  const [metrics, setMetrics] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.getActivityMetrics(),
      api.getActivityTimeline()
    ]).then(([m, t]) => {
      setMetrics(m);
      setTimeline(t);
      setLoading(false);
    }).catch(err => {
      toast?.(err.message, 'error');
      setLoading(false);
    });
  }, [toast]);

  const cards = metrics ? [
    { title: 'Total Documents', value: metrics.total_documents, icon: Database, accent: '#3b82f6' },
    { title: 'Active Workspaces', value: metrics.total_projects, icon: Folder, accent: '#8b5cf6' },
    { title: 'Chat Sessions', value: metrics.total_sessions, icon: MessageSquare, accent: '#10b981' },
    { title: 'Messages Sent', value: metrics.total_messages, icon: BarChart2, accent: '#f59e0b' },
  ] : [];

  const typeColors = {
    pdf: '#ef4444', docx: '#3b82f6', txt: '#8b5cf6', text: '#8b5cf6',
    repo: '#10b981', repository: '#10b981', web: '#f59e0b',
    md: '#0ea5e9', markdown: '#0ea5e9'
  };

  // Compute cumulative growth data from timeline
  const cumulativeData = timeline?.timeline ? (() => {
    let sum = 0;
    return timeline.timeline.map(d => {
      sum += d.documents;
      return { date: d.date, cumulative: sum, messages: d.messages };
    });
  })() : [];

  // Compute daily stacked data (messages + documents combined)
  const dailyComboData = timeline?.timeline ? timeline.timeline.slice(-14).map(d => ({
    date: d.date,
    documents: d.documents,
    messages: d.messages,
  })) : [];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

        {/* Workspace-style Header */}
        <header className="workspace-header" style={{
            padding: '0 20px', height: 60, borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
            zIndex: 10, position: 'sticky', top: 0,
            backdropFilter: 'blur(30px)', background: 'var(--bg-glass)',
            flexShrink: 0
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {isMobile && (
                    <button className="hamburger-btn" onClick={onOpenMobileMenu} title="Open Menu" style={{
                        width: 34, height: 34, borderRadius: 8, border: 'none',
                        background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                        <Menu size={18} />
                    </button>
                )}
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em', margin: 0 }}>
                    Global Activity
                </h2>
            </div>
        </header>

        <div className="smooth-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 40px' }}>

            {/* Page Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, marginBottom: 32 }}>
              <div>
                <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, marginBottom: 6 }}>Activity & Analytics</h1>
                <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Real-time metrics, usage trends, and ingestion statistics.</p>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                {/* 1. Main Platform Usage Chart Skeleton */}
                <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 32 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: isMobile ? 20 : 40 }}>
                    <div>
                      <div className="skel" style={{ width: 180, height: 20, borderRadius: 6, marginBottom: 12 }} />
                      {!isMobile && <div className="skel" style={{ width: 320, height: 14, borderRadius: 4 }} />}
                    </div>
                    <div className="skel" style={{ width: 140, height: 26, borderRadius: 100 }} />
                  </div>
                  <div className="skel" style={{ width: '100%', height: isMobile ? 220 : 320, borderRadius: 8 }} />
                </div>

                {/* 2. Stats Row Skeleton (Hero Box + 4 Grid) */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 3fr', gap: 20 }}>
                  <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 24 : 32, height: isMobile ? 160 : 200, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="skel" style={{ width: 130, height: 18, borderRadius: 6, marginBottom: 20 }} />
                    <div className="skel" style={{ width: 160, height: 44, borderRadius: 8, marginBottom: 12 }} />
                    <div className="skel" style={{ width: 100, height: 12, borderRadius: 4 }} />
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(2, 1fr)', gap: 12 }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                         <div className="skel" style={{ width: 90, height: 12, borderRadius: 4, marginBottom: 4 }} />
                         <div className="skel" style={{ width: 60, height: 28, borderRadius: 6 }} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Bottom 2-Col Grid Skeletons */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 20 }}>
                  {[1, 2].map(i => (
                    <div key={i} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 28 }}>
                      <div className="skel" style={{ width: 160, height: 18, borderRadius: 6, marginBottom: 12 }} />
                      <div className="skel" style={{ width: 240, height: 12, borderRadius: 4, marginBottom: 20 }} />
                      <div className="skel" style={{ width: '100%', height: isMobile ? 180 : 220, borderRadius: 8 }} />
                    </div>
                  ))}
                </div>

              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                {/* 30-day platform usage */}
                {timeline && (
                  <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 32, position: 'relative', overflow: 'hidden' }}>
                    
                    {/* Header + Legend */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: isMobile ? 20 : 40 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <BarChart2 size={16} color="#6366f1" />
                          <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)', margin: 0 }}>30-Day Platform Usage</h4>
                        </div>
                        {!isMobile && <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Document ingestion and AI message activity over time.</p>}
                      </div>
                      
                      <div style={{ display: 'flex', gap: 12, background: 'var(--bg-2)', padding: '6px 14px', borderRadius: 100, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 8px rgba(59,130,246,0.6)' }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Docs</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16,185,129,0.6)' }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Messages</span>
                        </div>
                      </div>
                    </div>

                    {/* Chart */}
                    <div style={{ width: '100%', height: isMobile ? 220 : 320 }}>
                      <ResponsiveContainer>
                        <AreaChart data={timeline.timeline} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorDocs" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorMsgs" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                          <XAxis 
                            dataKey="date" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: 'var(--text-4)', fontSize: 11 }}
                            tickFormatter={(str) => {
                              const date = new Date(str);
                              return `${date.getMonth()+1}/${date.getDate()}`;
                            }}
                            minTickGap={isMobile ? 40 : 30}
                            dy={10}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: 'var(--text-4)', fontSize: 11 }}
                            width={35}
                          />
                          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-light)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                          <Area 
                            type="monotone" 
                            dataKey="documents" 
                            stroke="#3b82f6" 
                            strokeWidth={2.5}
                            fillOpacity={1} 
                            fill="url(#colorDocs)" 
                            activeDot={{ r: 5, fill: '#3b82f6', stroke: 'var(--bg-0)', strokeWidth: 2, style: { filter: 'drop-shadow(0 0 6px rgba(59,130,246,0.8))' } }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="messages" 
                            stroke="#10b981" 
                            strokeWidth={2.5}
                            fillOpacity={1} 
                            fill="url(#colorMsgs)" 
                            activeDot={{ r: 5, fill: '#10b981', stroke: 'var(--bg-0)', strokeWidth: 2, style: { filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.8))' } }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 3fr', gap: 20 }}>
                  
                  {/* Hero Tokens Box */}
                  <div style={{
                    background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                    padding: isMobile ? 24 : 32, position: 'relative', overflow: 'hidden', cursor: 'default',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    transition: 'border-color 0.25s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{
                      position: 'absolute', top: '50%', right: 0, transform: 'translateY(-50%)',
                      width: 200, height: 200, background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
                      pointerEvents: 'none'
                    }} />
                    <Zap size={80} style={{
                      position: 'absolute', right: -20, top: '50%', transform: 'translateY(-50%) rotate(-12deg)',
                      color: '#f97316', opacity: 0.05, pointerEvents: 'none'
                    }} />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, position: 'relative', zIndex: 1 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(249,115,22,0.1)', color: '#f97316'
                      }}>
                        <Zap size={16} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>Tokens Processed</span>
                    </div>

                    <div style={{ position: 'relative', zIndex: 1 }}>
                      <span style={{ fontSize: isMobile ? 36 : 44, fontWeight: 800, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {metrics?.total_tokens_ingested?.toLocaleString() ?? '—'}
                      </span>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Total tokens chunked and embedded</p>
                    </div>
                  </div>

                  {/* 4-Grid Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(2, 1fr)', gap: 12 }}>
                    {cards.map(card => (
                      <div key={card.title} style={{
                        background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                        padding: isMobile ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 8,
                        position: 'relative', overflow: 'hidden', cursor: 'default',
                        transition: 'border-color 0.25s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = card.accent + '44'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                      >
                        <card.icon size={60} style={{
                          position: 'absolute', right: -8, bottom: -10,
                          color: card.accent, opacity: 0.04, transform: 'rotate(-8deg)', pointerEvents: 'none'
                        }} />

                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>{card.title}</span>
                        <span style={{ fontSize: isMobile ? 24 : 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.03em' }}>
                          {card.value?.toLocaleString() ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>

                </div>

                {/* Cumulative growth and 14-day breakdown */}
                {timeline && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 20 }}>
                    
                    {/* Cumulative Growth */}
                    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 28, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <TrendingUp size={15} color="#3b82f6" />
                        <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)', margin: 0 }}>Cumulative Growth</h4>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16, margin: '0 0 16px 0' }}>Running total of documents over 30 days.</p>
                      
                      <div style={{ height: isMobile ? 180 : 220 }}>
                        <ResponsiveContainer>
                          <LineChart data={cumulativeData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-4)', fontSize: 10 }}
                              tickFormatter={(str) => { const d = new Date(str); return `${d.getMonth()+1}/${d.getDate()}`; }} minTickGap={40} dy={8} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-4)', fontSize: 10 }} width={30} />
                            <Tooltip content={<CustomTooltip />} />
                            <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2.5} dot={false}
                              activeDot={{ r: 5, fill: '#3b82f6', stroke: 'var(--bg-0)', strokeWidth: 2 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 14-Day Daily Breakdown */}
                    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 28, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Activity size={15} color="#8b5cf6" />
                        <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)', margin: 0 }}>14-Day Daily Breakdown</h4>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16, margin: '0 0 16px 0' }}>Stacked daily docs and messages for the last 2 weeks.</p>
                      
                      <div style={{ height: isMobile ? 180 : 220 }}>
                        <ResponsiveContainer>
                          <ComposedChart data={dailyComboData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-4)', fontSize: 10 }}
                              tickFormatter={(str) => { const d = new Date(str); return `${d.getMonth()+1}/${d.getDate()}`; }} minTickGap={30} dy={8} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-4)', fontSize: 10 }} width={30} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="documents" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={isMobile ? 12 : 18} name="documents" opacity={0.8} />
                            <Bar dataKey="messages" fill="#10b981" radius={[4, 4, 0, 0]} barSize={isMobile ? 12 : 18} name="messages" opacity={0.8} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Source ecosystem and top workspaces */}
                {timeline && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 20, marginBottom: 40 }}>
                    
                    {/* Source Ecosystem Donut */}
                    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 28, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <CircleDot size={15} color="#8b5cf6" />
                        <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)', margin: 0 }}>Source Ecosystem</h4>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px 0' }}>Composition of ingested file types.</p>
                      
                      {timeline.source_types.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>No documents yet</div>
                      ) : (
                        <div style={{ height: isMobile ? 240 : 280, position: 'relative' }}>
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie
                                data={timeline.source_types}
                                dataKey="count"
                                nameKey="type"
                                cx="50%"
                                cy="50%"
                                innerRadius={isMobile ? 55 : 65}
                                outerRadius={isMobile ? 80 : 95}
                                paddingAngle={5}
                                stroke="none"
                                isAnimationActive={true}
                              >
                                {timeline.source_types.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={typeColors[entry.type] || 'var(--primary)'} style={{ filter: `drop-shadow(0px 3px 8px ${typeColors[entry.type] || 'var(--primary)'}44)` }} />
                                ))}
                              </Pie>
                              <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ background: 'var(--bg-glass)', backdropFilter: 'blur(20px)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow-lg)' }} itemStyle={{ fontWeight: 600, textTransform: 'uppercase' }} />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value) => <span style={{ color: 'var(--text-2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{value}</span>} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                            <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', display: 'block', lineHeight: 1 }}>{timeline.source_types.reduce((sum, item) => sum + item.count, 0)}</span>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>Sources</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Top Workspaces Bar — Clickable */}
                    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: isMobile ? 16 : 28, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Folder size={15} color="#f97316" />
                        <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)', margin: 0 }}>Top Workspaces</h4>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px 0' }}>Click a bar to open the workspace.</p>
                      
                      {!timeline.top_projects || timeline.top_projects.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>No active projects</div>
                      ) : (
                        <div style={{ height: isMobile ? 240 : 280 }}>
                          <ResponsiveContainer>
                            <BarChart data={timeline.top_projects} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                              onClick={(data) => {
                                if (data && data.activePayload && data.activePayload[0]) {
                                  const pid = data.activePayload[0].payload.project_id;
                                  if (pid) navigate(`/p/${pid}`);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" opacity={0.4} />
                              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-4)', fontSize: 10 }} />
                              <YAxis 
                                type="category" 
                                dataKey="name" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}
                                width={isMobile ? 80 : 110}
                              />
                              <Tooltip cursor={{fill: 'var(--bg-hover)'}} contentStyle={{ background: 'var(--bg-glass)', backdropFilter: 'blur(20px)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow-lg)' }} itemStyle={{ color: '#f97316', fontWeight: 600 }} />
                              <Bar dataKey="count" fill="#f97316" radius={[0, 6, 6, 0]} barSize={isMobile ? 18 : 22} name="Total Docs">
                                {timeline.top_projects.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={index === 0 ? '#f97316' : 'rgba(249,115,22,0.4)'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
