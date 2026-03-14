import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { Menu, Search, FileText, FileType, AlignLeft, Github, Globe, FileArchive } from 'lucide-react';
import { useToast } from '../components/ui/Toast';

const SOURCE_ICONS = {
  pdf: <FileText size={16} />,
  docx: <FileType size={16} />,
  text: <AlignLeft size={16} />,
  repository: <Github size={16} />,
  web: <Globe size={16} />,
  markdown: <FileArchive size={16} />
};

export default function DiscoveryPage({ isMobile, onOpenMobileMenu }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.getGlobalDocuments()
      .then(docs => {
        setDocuments(docs || []);
        setLoading(false);
      })
      .catch(err => {
        toast?.(err.message, 'error');
        setLoading(false);
      });
  }, [toast]);

  const filteredDocs = useMemo(() => {
    if (!searchQuery) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(d => 
      d.title.toLowerCase().includes(q) || 
      d.project_name.toLowerCase().includes(q) ||
      (d.summary && d.summary.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

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
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Global Discovery</h1>
        </div>
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 32 }}>
        
        {/* Search Bar */}
        <div style={{
          maxWidth: 600, margin: '0 auto 32px auto', position: 'relative'
        }}>
          <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input 
            type="text"
            placeholder="Search documents by title, project, or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '14px 16px 14px 44px',
              borderRadius: 12, border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-2)', color: 'var(--text)',
              fontSize: 15, outline: 'none', transition: 'border-color 0.2s ease',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--primary)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40, color: 'var(--text-3)' }}>
            Loading library...
          </div>
        ) : filteredDocs.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-3)' }}>
            <FileText size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
            <p>No documents found.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 24,
            alignItems: 'start'
          }}>
            {filteredDocs.map(doc => (
              <div key={doc.id} style={{
                backgroundColor: 'var(--bg-2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 13, fontWeight: 500, backgroundColor: 'var(--bg-3)', padding: '4px 8px', borderRadius: 6 }}>
                    {SOURCE_ICONS[doc.source_type] || <FileText size={14} />}
                    <span style={{ textTransform: 'capitalize' }}>{doc.source_type}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                </div>
                
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {doc.title}
                </h3>

                <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 500 }}>
                  Workspace: {doc.project_name}
                </div>

                {doc.summary && (
                  <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {doc.summary}
                  </p>
                )}
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)' }}>
                  <span>{Math.round(doc.char_count / 1000)}k chars</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: doc.processing_status === 'ready' ? 'var(--green)' : doc.processing_status === 'processing' ? 'var(--yellow)' : 'var(--red)' }} />
                    {doc.processing_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
