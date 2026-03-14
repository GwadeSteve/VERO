import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Menu, Activity, Database, Folder, MessageSquare, Zap, BarChart2 } from 'lucide-react';
import { useToast } from '../components/ui/Toast';

export default function ActivityPage({ isMobile, onOpenMobileMenu }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api.getActivityMetrics()
      .then(data => {
        setMetrics(data);
        setLoading(false);
      })
      .catch(err => {
        toast?.(err.message, 'error');
        setLoading(false);
      });
  }, [toast]);

  const MetricCard = ({ title, value, icon: Icon, color }) => (
    <div style={{
      backgroundColor: 'var(--bg-2)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
      position: 'relative', overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-2)' }}>
        <div style={{ 
          width: 40, height: 40, borderRadius: 10, backgroundColor: `var(--${color}-transparent, rgba(255,255,255,0.05))`, 
          color: `var(--${color}, var(--primary))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon size={20} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
      </div>
      <div>
        <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
          {value != null ? value.toLocaleString() : '-'}
        </span>
      </div>
      {/* Subtle glow effect */}
      <div style={{
        position: 'absolute', right: -20, bottom: -20, width: 100, height: 100,
        background: `radial-gradient(circle, var(--${color}, var(--primary)) 0%, transparent 70%)`,
        opacity: 0.1, filter: 'blur(20px)'
      }} />
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      backgroundColor: 'var(--bg-1)', position: 'relative'
    }}>
      {/* Header */}
      <header className="workspace-header" style={{
        padding: '0 24px', height: 60, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isMobile && (
            <button onClick={onOpenMobileMenu} className="icon-btn" style={{ marginLeft: -8 }}>
              <Menu size={20} />
            </button>
          )}
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Platform Activity</h1>
        </div>
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 32 }}>
        
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ marginBottom: 32, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-2)' }}>
            <Activity size={24} color="var(--primary)" />
            <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Usage Metics</h2>
            <span style={{ fontSize: 13, background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 4, marginLeft: 'auto' }}>All Time</span>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40, color: 'var(--text-3)' }}>
              Loading metrics...
            </div>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24
            }}>
              <MetricCard 
                title="Total Documents" 
                value={metrics?.total_documents} 
                icon={Database} 
                color="blue" 
              />
              <MetricCard 
                title="Workspaces" 
                value={metrics?.total_projects} 
                icon={Folder} 
                color="purple" 
              />
              <MetricCard 
                title="Chat Sessions" 
                value={metrics?.total_sessions} 
                icon={MessageSquare} 
                color="green" 
              />
              <MetricCard 
                title="Messages Sent" 
                value={metrics?.total_messages} 
                icon={BarChart2} 
                color="yellow" 
              />
              <MetricCard 
                title="Tokens Processed" 
                value={metrics?.total_tokens_ingested} 
                icon={Zap} 
                color="orange" 
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
