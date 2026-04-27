import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Folder, Clock, Trash2, Loader2, FileText, CheckSquare, Square, X, Layers, Menu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';

export default function ProjectsPage({ onRefreshProjects, isMobile, onOpenMobileMenu }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [creating, setCreating] = useState(false);

    // Selection
    const [selected, setSelected] = useState(new Set());
    const [hovered, setHovered] = useState(null);

    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => { load(); }, []);

    const load = async () => {
        try { setProjects(await api.getProjects()); }
        catch { toast?.('Failed to load projects', 'error'); }
        finally { setLoading(false); }
    };

    const create = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setCreating(true);
        try {
            const p = await api.createProject(name, desc);
            setProjects(prev => [...prev, p]);
            setShowForm(false); setName(''); setDesc('');
            toast?.(`Project "${p.name}" successfully created!`, 'success');
            onRefreshProjects?.();
            select(p.id);
        } catch (err) { toast?.(err.message, 'error'); }
        finally { setCreating(false); }
    };

    const select = (id) => { navigate(`/p/${id}`); };

    // Deletion logic.
    const deleteSelected = async () => {
        if (selected.size === 0) return;
        const count = selected.size;
        if (!window.confirm(`Are you sure you want to delete ${count} project${count > 1 ? 's' : ''}?`)) return;

        const toDelete = Array.from(selected);

        // Optimistic UI update
        setProjects(prev => prev.filter(p => !toDelete.includes(p.id)));
        setSelected(new Set());

        let failed = 0;
        for (const id of toDelete) {
            try { await api.deleteProject(id); }
            catch (err) { failed++; }
        }

        if (failed === 0) {
            toast?.(`Successfully deleted ${count} project${count > 1 ? 's' : ''}.`, 'success');
            onRefreshProjects?.();
        } else {
            toast?.(`Failed deleting ${failed} project${failed > 1 ? 's' : ''}.`, 'error');
            load(); // Reload to restore failed ones
        }
    };

    const toggleSelect = (e, id) => {
        e.stopPropagation();
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const toggleAll = (e) => {
        e.stopPropagation();
        if (selected.size === projects.length && projects.length > 0) {
            setSelected(new Set());
        } else {
            setSelected(new Set(projects.map(p => p.id)));
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

                {/* Shared Workspace-style Header */}
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
                            Library
                        </h2>
                    </div>
                </header>

                <div className="smooth-scroll" style={{ flex: 1, overflowY: 'auto' }}>
                    <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 40px' }}>

                        {/* Header Context */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: 40 }}>
                            <div style={{ flex: '1 1 300px' }}>
                                <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Projects</h1>
                                <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Isolated knowledge bases with their own documents and chat history.</p>
                            </div>
                            {projects.length > 0 && (
                                <button onClick={() => setShowForm(f => !f)} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 18px',
                                    fontSize: 13, fontWeight: 500, fontFamily: 'var(--font)',
                                    background: 'var(--accent)', color: 'var(--accent-text)',
                                    border: 'none', borderRadius: 'var(--r)',
                                    cursor: 'pointer', flexShrink: 0,
                                    width: isMobile ? '100%' : 'auto'
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = 0.9; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = 1; }}
                                >
                                    <Plus size={15} /> New Project
                                </button>
                            )}
                        </div>

                        {/* Create Form (only when projects exist — empty state has its own inline form) */}
                        {showForm && projects.length > 0 && (
                            <form onSubmit={create} style={{
                                display: 'flex', 
                                flexDirection: isMobile ? 'column' : 'row',
                                gap: isMobile ? 10 : 12, marginBottom: 32,
                                padding: isMobile ? 16 : 24, background: 'var(--bg-1)', borderRadius: 'var(--r-lg)',
                                border: '1px solid var(--border)', 
                                alignItems: isMobile ? 'stretch' : 'flex-end',
                                animation: 'fadeIn 0.2s ease both',
                            }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Name</label>
                                    <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q4 Financial Reports"
                                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: isMobile ? '8px 12px' : '10px 14px', borderRadius: 'var(--r)', fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%' }}
                                        onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                    />
                                </div>
                                <div style={{ flex: isMobile ? 'none' : 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description (Optional)</label>
                                    <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this workspace for?"
                                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: isMobile ? '8px 12px' : '10px 14px', borderRadius: 'var(--r)', fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%' }}
                                        onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                    />
                                </div>
                                
                                <div style={{ 
                                    display: 'flex', 
                                    gap: 12, 
                                    marginTop: isMobile ? 4 : 0,
                                    width: isMobile ? '100%' : 'auto' 
                                }}>
                                    <button type="button" onClick={() => setShowForm(false)} style={{
                                        flex: isMobile ? 1 : 'none',
                                        padding: isMobile ? '8px 16px' : '10px 16px', background: 'none', border: '1px solid var(--border)',
                                        color: 'var(--text-3)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font)',
                                    }}>Cancel</button>
                                    <button type="submit" disabled={creating || !name.trim()} style={{
                                        flex: isMobile ? 1 : 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: isMobile ? '8px 24px' : '10px 24px', background: 'var(--accent)', color: 'var(--accent-text)',
                                        border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13,
                                        fontWeight: 600, fontFamily: 'var(--font)', opacity: (creating || !name.trim()) ? 0.4 : 1
                                    }}>
                                        {creating ? <Loader2 size={14} className="spin" /> : 'Create'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Action Bar (When selected) */}
                        {selected.size > 0 && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 20px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
                                borderRadius: 'var(--r-lg)', marginBottom: 20, animation: 'fadeIn 0.15s ease both'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex' }}><X size={16} /></button>
                                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}>{selected.size} project{selected.size > 1 ? 's' : ''} selected</span>
                                </div>
                                <button onClick={deleteSelected} style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--r)',
                                    padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                }}><Trash2 size={14} /> Delete Selected</button>
                            </div>
                        )}

                        {/* Content */}
                        {loading ? (
                            /* Skeleton loading. */
                            <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                {/* Skeleton table header */}
                                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--border)', gap: 12 }}>
                                    <div className="skel" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} />
                                    <div className="skel" style={{ width: '25%', height: 10, borderRadius: 4 }} />
                                    <div className="skel" style={{ width: '35%', height: 10, borderRadius: 4, marginLeft: 'auto' }} />
                                    <div className="skel" style={{ width: '15%', height: 10, borderRadius: 4 }} />
                                    <div className="skel" style={{ width: '8%', height: 10, borderRadius: 4 }} />
                                </div>
                                {/* Skeleton rows */}
                                {Array.from({ length: 15 }, (_, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', padding: '14px 20px',
                                        borderBottom: i < 14 ? '1px solid var(--border)' : 'none',
                                        gap: 12,
                                    }}>
                                        <div className="skel" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, animationDelay: `${i * 0.06}s` }} />
                                        <div style={{ width: '30%', display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16 }}>
                                            <div className="skel" style={{ width: `${55 + (i * 13) % 40}%`, height: 12, borderRadius: 4, animationDelay: `${i * 0.06}s` }} />
                                        </div>
                                        <div style={{ width: '40%', paddingRight: 16 }}>
                                            <div className="skel" style={{ width: `${40 + (i * 17) % 50}%`, height: 10, borderRadius: 4, animationDelay: `${i * 0.06}s` }} />
                                        </div>
                                        <div style={{ width: '20%', paddingRight: 16 }}>
                                            <div className="skel" style={{ width: 80, height: 10, borderRadius: 4, animationDelay: `${i * 0.06}s` }} />
                                        </div>
                                        <div style={{ width: '10%' }}>
                                            <div className="skel" style={{ width: 28, height: 10, borderRadius: 4, animationDelay: `${i * 0.06}s` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : projects.length === 0 ? (
                            /* Empty state. */
                            <div className="sota-reflective-card" style={{
                                marginTop: 32,
                                borderRadius: 'var(--r-lg)',
                                position: 'relative',
                            }}>
                                {/* Main content area */}
                                <div style={{
                                    position: 'relative',
                                    padding: isMobile ? '44px 24px 40px' : '56px 48px 48px',
                                }}>
                                    {/* Top row: context + heading + CTA */}
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: isMobile ? 'column' : 'row',
                                        alignItems: isMobile ? 'stretch' : 'center',
                                        gap: isMobile ? 32 : 0,
                                    }}>
                                        <div style={{ flex: 1 }}>
                                            {/* Eyebrow / Icon box */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 14,
                                                marginBottom: 20,
                                            }}>
                                                <div style={{
                                                    width: 44, height: 44, borderRadius: 12,
                                                    background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: 'var(--accent)'
                                                }}>
                                                    <Layers size={20} strokeWidth={2} />
                                                </div>
                                                <div style={{
                                                    fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
                                                    textTransform: 'uppercase', color: 'var(--accent)',
                                                }}>
                                                    Getting Started
                                                </div>
                                            </div>

                                            <h3 style={{
                                                fontSize: isMobile ? 24 : 28, fontWeight: 700,
                                                letterSpacing: '-0.03em', color: 'var(--text)',
                                                margin: 0, lineHeight: 1.15,
                                            }}>
                                                Create a project
                                            </h3>
                                            <p style={{
                                                fontSize: 15, color: 'var(--text-3)',
                                                lineHeight: 1.6, margin: '10px 0 0 0',
                                                maxWidth: 420,
                                            }}>
                                                Each project is an isolated workspace with its own documents, search index, and conversations.
                                            </p>
                                        </div>

                                        {/* CTA */}
                                        <button
                                            onClick={() => setShowForm(f => !f)}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                                padding: '0 24px', height: 44, borderRadius: 'var(--r)',
                                                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font)',
                                                background: showForm ? 'transparent' : 'var(--accent)',
                                                color: showForm ? 'var(--text-3)' : 'var(--accent-text)',
                                                border: showForm ? '1px solid var(--border)' : 'none',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease',
                                                flexShrink: 0,
                                                width: isMobile ? '100%' : 'auto',
                                            }}
                                            onMouseEnter={e => {
                                                if (!showForm) e.currentTarget.style.opacity = '0.88';
                                                else { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-2)'; }
                                            }}
                                            onMouseLeave={e => {
                                                if (!showForm) e.currentTarget.style.opacity = '1';
                                                else { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)'; }
                                            }}
                                        >
                                            {showForm ? (
                                                <><X size={15} style={{ color: 'var(--red)', opacity: 0.7 }} /> Cancel</>
                                            ) : (
                                                <><Plus size={16} strokeWidth={2.5} /> New Project</>
                                            )}
                                        </button>
                                    </div>

                                    {/* Inline form — inside the card, no chopping */}
                                    <div style={{
                                        maxHeight: showForm ? 180 : 0,
                                        opacity: showForm ? 1 : 0,
                                        overflow: 'hidden',
                                        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
                                        marginTop: showForm ? 32 : 0,
                                    }}>
                                        {/* Subtle divider */}
                                        <div style={{
                                            height: 1, background: 'var(--border)', marginBottom: 28,
                                        }} />

                                        <form onSubmit={create} style={{
                                            display: 'flex',
                                            flexDirection: isMobile ? 'column' : 'row',
                                            gap: 14,
                                            alignItems: isMobile ? 'stretch' : 'flex-end',
                                        }}>
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <label style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Project Name</label>
                                                <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Machine Learning Notes"
                                                    style={{
                                                        background: 'var(--bg-2)', border: '1px solid var(--border)',
                                                        color: 'var(--text)', padding: '11px 14px', borderRadius: 'var(--r)',
                                                        fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%',
                                                        transition: 'border-color 0.15s ease',
                                                    }}
                                                    onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                                />
                                            </div>
                                            <div style={{ flex: isMobile ? 'none' : 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <label style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                                                <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's this workspace for?"
                                                    style={{
                                                        background: 'var(--bg-2)', border: '1px solid var(--border)',
                                                        color: 'var(--text)', padding: '11px 14px', borderRadius: 'var(--r)',
                                                        fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%',
                                                        transition: 'border-color 0.15s ease',
                                                    }}
                                                    onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                                />
                                            </div>
                                            <button type="submit" disabled={creating || !name.trim()} style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                padding: '0 24px', height: 44, background: 'var(--accent)', color: 'var(--accent-text)',
                                                border: 'none', borderRadius: 'var(--r)',
                                                cursor: (creating || !name.trim()) ? 'not-allowed' : 'pointer',
                                                fontSize: 13, fontWeight: 600, fontFamily: 'var(--font)',
                                                opacity: (creating || !name.trim()) ? 0.3 : 1,
                                                flexShrink: 0, whiteSpace: 'nowrap',
                                                transition: 'opacity 0.15s ease',
                                            }}>
                                                {creating ? <Loader2 size={14} className="spin" /> : 'Create'}
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Project list. */
                            <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                {isMobile ? (
                                    // MOBILE STACKED LIST
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        {projects.map((p, i) => {
                                            const isSelected = selected.has(p.id);
                                            return (
                                                <div key={p.id}
                                                    onClick={() => select(p.id)}
                                                    style={{
                                                        display: 'flex', flexDirection: 'column', gap: 12,
                                                        padding: '16px', borderBottom: i < projects.length - 1 ? '1px solid var(--border)' : 'none',
                                                        cursor: 'pointer', background: isSelected ? 'var(--accent-dim)' : 'transparent',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                            <div onClick={e => toggleSelect(e, p.id)} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-4)' }}>
                                                                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                                            </div>
                                                            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{p.name}</span>
                                                        </div>
                                                        <ArrowRight size={16} color="var(--text-4)" />
                                                    </div>
                                                    
                                                    {p.description && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-3)', paddingLeft: 30 }}>
                                                            {p.description}
                                                        </div>
                                                    )}

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 30, marginTop: 4 }}>
                                                        <div style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <Clock size={12} /> {new Date(p.updated_at).toLocaleDateString()}
                                                        </div>
                                                        <div style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <FileText size={12} color="var(--text-4)" /> {p.document_count ?? 0} docs
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    // DESKTOP GRID LIST
                                    <>
                                        {/* Table header */}
                                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                                            <div onClick={toggleAll} style={{ width: 36, cursor: 'pointer', display: 'flex', color: selected.size === projects.length ? 'var(--accent)' : 'var(--text-4)' }}>
                                                {selected.size === projects.length ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </div>
                                            <div style={{ width: '30%', paddingRight: 16 }}>Name</div>
                                            <div style={{ width: '40%', paddingRight: 16 }}>Description</div>
                                            <div style={{ width: '20%', paddingRight: 16 }}>Last Activity</div>
                                            <div style={{ width: '10%' }}>Documents</div>
                                            <div style={{ width: 60 }}></div>
                                        </div>
                                        {/* Rows */}
                                        {projects.map(p => {
                                            const isSelected = selected.has(p.id);
                                            return (
                                                <div key={p.id}
                                                    onClick={() => select(p.id)}
                                                    onMouseEnter={() => setHovered(p.id)}
                                                    onMouseLeave={() => setHovered(null)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center',
                                                        padding: '14px 20px', borderBottom: '1px solid var(--border)',
                                                        cursor: 'pointer',
                                                        background: isSelected ? 'var(--accent-dim)' : hovered === p.id ? 'var(--bg-hover)' : 'transparent',
                                                        transition: 'background 0.15s ease',
                                                    }}
                                                >
                                                    <div onClick={e => toggleSelect(e, p.id)} style={{ width: 36, display: 'flex', color: isSelected ? 'var(--accent)' : 'var(--text-4)', cursor: 'pointer', flexShrink: 0 }}>
                                                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                    </div>
                                                    <div style={{ width: '30%', paddingRight: 16, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                                                        <span style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</span>
                                                    </div>
                                                    <div style={{ width: '40%', paddingRight: 16, color: 'var(--text-3)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {p.description || 'No description'}
                                                    </div>
                                                    <div style={{ width: '20%', paddingRight: 16, fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        <Clock size={14} style={{ flexShrink: 0 }} /> 
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {new Date(p.updated_at).toLocaleString([], { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div style={{ width: '10%', fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                                        <FileText size={14} color="var(--text-4)" style={{ flexShrink: 0 }} /> {p.document_count ?? 0}
                                                    </div>
                                                    <div style={{ width: 60, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                                        <button
                                                            title="Delete Workspace"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (window.confirm(`Delete workspace "${p.name}"? This cannot be undone.`)) {
                                                                    try {
                                                                        await api.deleteProject(p.id);
                                                                        setProjects(prev => prev.filter(x => x.id !== p.id));
                                                                        onRefreshProjects?.();
                                                                        toast?.('Workspace deleted.', 'success');
                                                                    } catch { toast?.('Failed to delete workspace.', 'error'); }
                                                                }
                                                            }}
                                                            style={{
                                                                width: 28, height: 28, borderRadius: 6, border: 'none',
                                                                background: 'transparent', color: 'var(--text-4)',
                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                transition: 'all 0.15s ease', opacity: hovered === p.id ? 1 : 0
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                        <ArrowRight size={16} color={hovered === p.id ? 'var(--accent)' : 'var(--text-4)'} style={{ flexShrink: 0, transition: 'color 0.15s ease' }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
