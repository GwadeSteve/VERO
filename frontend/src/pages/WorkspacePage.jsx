import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';
import {
    Send, Search, Loader2, FileText, ArrowUp,
    RefreshCw, User, Bot, CheckCircle2, UploadCloud, Globe,
    X, ChevronRight, FileArchive, Sparkles, Wand2, Info
} from 'lucide-react';

export default function WorkspacePage({ projectId, activeSessionId, setSessions }) {
    // Project info
    const [project, setProject] = useState(null);

    // Docs & ingestion
    const [docs, setDocs] = useState([]);
    const [docsLoading, setDocsLoading] = useState(true);
    const [ingesting, setIngesting] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [url, setUrl] = useState('');
    const [showUrl, setShowUrl] = useState(false);

    // Chat
    const [messages, setMessages] = useState([]);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [traceResults, setTraceResults] = useState([]);
    const [activeCitation, setActiveCitation] = useState(null);
    const [modelKnowledge, setModelKnowledge] = useState(false);

    const chatEndRef = useRef(null);
    const fileRef = useRef(null);
    const toast = useToast();
    const navigate = useNavigate();

    // Load project & docs on PID change
    useEffect(() => {
        if (projectId) {
            loadProject();
            fetchDocs();
        }
    }, [projectId]);

    // Load session messages on SID change
    useEffect(() => {
        if (activeSessionId) {
            loadSession(activeSessionId);
        } else {
            setMessages([]);
            setTraceResults([]);
            setStreamingText('');
            setIsStreaming(false);
        }
    }, [activeSessionId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText, searching, isStreaming]);

    const loadProject = async () => {
        try { setProject(await api.getProject(projectId)); } catch { }
    };

    const fetchDocs = async () => {
        setDocsLoading(true);
        try { setDocs(await api.getDocuments(projectId)); }
        catch (e) { console.error(e); }
        finally { setDocsLoading(false); }
    };

    const loadSession = async (sid) => {
        try {
            const s = await api.getSession(sid);
            setMessages(s.messages.map(m => ({ role: m.role, text: m.content })));
            // Reset trace/citations when switching sessions
            setTraceResults([]);
            setActiveCitation(null);
        } catch (err) {
            toast?.('Failed to load conversation history.', 'error');
            setActiveSessionId(null);
        }
    };

    // ── Streaming simulation ─────────────────────────
    const streamText = (fullText, onDone) => {
        setIsStreaming(true);
        setStreamingText('');
        const words = fullText.split(' ');
        let i = 0;
        const iv = setInterval(() => {
            if (i < words.length) {
                setStreamingText(prev => prev + (i > 0 ? ' ' : '') + words[i]);
                i++;
            } else {
                clearInterval(iv);
                setIsStreaming(false);
                setStreamingText('');
                onDone(fullText);
            }
        }, 25);
    };

    const pollStatus = (docTitle) => {
        const iv = setInterval(async () => {
            try {
                const allDocs = await api.getDocuments(projectId);
                setDocs(allDocs);
                const doc = allDocs.find(d => d.title === docTitle);
                if (doc?.processing_status === 'ready') {
                    toast?.(`"${docTitle}" is ready for chat.`, 'success');
                    clearInterval(iv);
                } else if (doc?.processing_status === 'error') {
                    clearInterval(iv);
                }
            } catch { clearInterval(iv); }
        }, 2500);
        setTimeout(() => clearInterval(iv), 60000);
    };

    // ── Ingestion ────────────────────────────────────
    const ingestFile = async (file) => {
        if (!file || !projectId) return;

        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'text/plain',
            'text/markdown',
            'text/csv'
        ];

        if (!allowedTypes.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
            toast?.(`Unsupported file format: ${file.name}. Please upload PDF, DOCX, TXT, MD, or CSV.`, 'error');
            return;
        }

        setIngesting(true);
        const shortName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
        toast?.(`File ${shortName} processing...`, 'info');
        try {
            const doc = await api.ingestFile(projectId, file);
            if (fileRef.current) fileRef.current.value = '';
            await fetchDocs();
            pollStatus(doc.title);
        } catch (err) { toast?.('Import failed.', 'error'); }
        finally { setIngesting(false); }
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) ingestFile(f);
    }, [projectId]);

    const handleUrlIngest = async (e) => {
        e.preventDefault();
        if (!url.trim() || !projectId) return;

        const isRepo = url.includes('github.com');
        const prefix = isRepo ? 'Repo' : 'Web';
        const cleanUrl = url.replace(/https?:\/\/(www\.)?/, '');
        const shortUrl = cleanUrl.length > 25 ? cleanUrl.substring(0, 25) + '...' : cleanUrl;

        setIngesting(true);
        toast?.(`${prefix} ${shortUrl} processing...`, 'info');
        try {
            const doc = await api.ingestUrl(projectId, url);
            setUrl(''); setShowUrl(false);
            await fetchDocs();
            pollStatus(doc.title);
        } catch (err) { toast?.('Import failed', 'error'); }
        finally { setIngesting(false); }
    };

    // ── Chat ─────────────────────────────────────────
    const send = async (e) => {
        e?.preventDefault();
        if (!query.trim() || !projectId || searching || docs.length === 0) return;

        const q = query.trim();
        setQuery('');
        setMessages(prev => [...prev, { role: 'user', text: q }]);
        setSearching(true);
        setTraceResults([]); setActiveCitation(null);

        try {
            let sid = activeSessionId;
            if (!sid) {
                const s = await api.createSession(projectId, q.substring(0, 40));
                sid = s.id;
                navigate(`/p/${projectId}/c/${sid}`, { replace: true });
                if (setSessions) setSessions(prev => [s, ...prev]);
            }

            // 1. Semantic Retrieval
            const sr = await api.hybridSearch(projectId, q);
            setTraceResults(sr.results || []);

            // 2. LLM Chat
            const cr = await api.chat(sid, q, modelKnowledge);

            setSearching(false);
            streamText(cr.answer, (fullText) => {
                setMessages(prev => [...prev, {
                    role: 'assistant', text: fullText,
                    citations: cr.citations || [],
                    sufficient: cr.found_sufficient_info,
                }]);
            });
        } catch (err) {
            setMessages(prev => [...prev, { role: 'error', text: 'Issues connecting to VERO intelligence.' }]);
            setSearching(false);
        }
    };

    const getPreciseStatus = (doc) => {
        const s = doc.processing_status;
        if (s === 'ready') return { label: 'Knowledge Ready', color: 'var(--green)', icon: CheckCircle2 };
        if (s === 'processing') return { label: 'Step 1/3: Extracting Text', color: 'var(--accent)', icon: Loader2 };
        if (s === 'chunking') return { label: 'Step 2/3: Semantic Splitting', color: 'var(--accent)', icon: Loader2 };
        if (s === 'embedding') return { label: 'Step 3/3: Vectorizing Context', color: 'var(--accent)', icon: Loader2 };
        if (s === 'error') return { label: 'Sync Failed', color: 'var(--red)', icon: X };
        return { label: 'In Queue', color: 'var(--text-4)', icon: Clock };
    };

    if (!projectId) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', background: 'var(--bg-0)' }}>
                <Sparkles size={48} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.2 }} />
                <p style={{ fontSize: 16, color: 'var(--text-3)', fontWeight: 500 }}>Select a workspace to begin</p>
            </div>
        );
    }

    // Pre-calculate traces by doc
    const docTraces = {};
    traceResults.forEach((r, i) => {
        if (!docTraces[r.doc_title]) docTraces[r.doc_title] = [];
        docTraces[r.doc_title].push({ ...r, index: i });
    });

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

            {/* ═══════ CENTER: Main Chat ═══════ */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

                {/* Workspace Header */}
                <header style={{
                    padding: '16px 32px', borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-1)', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', zIndex: 10,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 750, color: 'var(--text)' }}>
                            {project?.name || 'Workspace'}
                        </h2>
                        <div style={{ height: 16, width: 1, background: 'var(--border)' }} />
                        <div style={{ fontSize: 13, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileArchive size={14} /> {docs.length} Resources
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setShowUrl(v => !v)} style={{
                            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            background: showUrl ? 'var(--accent-dim)' : 'var(--bg-2)',
                            color: showUrl ? 'var(--accent)' : 'var(--text-2)',
                            border: showUrl ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                            cursor: 'pointer', transition: 'all 0.2s',
                        }}>
                            <Globe size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> Resource Link
                        </button>
                    </div>
                </header>

                {/* Global Action Bar (Uploads & URL) */}
                {(showUrl || dragOver || ingesting) && (
                    <div style={{ padding: '8px 32px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                        {showUrl && (
                            <form onSubmit={handleUrlIngest} style={{ flex: 1, display: 'flex', gap: 8 }}>
                                <input autoFocus value={url} onChange={e => setUrl(e.target.value)}
                                    placeholder="Paste URL to ingest (Website, PDF Link...)"
                                    style={{
                                        flex: 1, height: 36, padding: '0 12px', background: 'var(--bg-2)',
                                        border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
                                        fontSize: 13, outline: 'none'
                                    }}
                                />
                                <button type="submit" disabled={!url.trim() || ingesting} style={{
                                    padding: '0 16px', background: 'var(--accent)', color: 'var(--bg-0)',
                                    border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    opacity: (!url.trim() || ingesting) ? 0.5 : 1
                                }}>Import</button>
                            </form>
                        )}
                    </div>
                )}

                {/* Chat Feed */}
                <div style={{ flex: 1, overflowY: 'auto', scrollPaddingBottom: 100 }}>
                    {messages.length === 0 && !searching && !isStreaming ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                            <div style={{
                                width: 80, height: 80, borderRadius: 24, background: 'var(--accent-dim)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid var(--accent-border)', marginBottom: 24,
                                animation: 'pulse 3s infinite ease-in-out'
                            }}>
                                <Sparkles size={40} color="var(--accent)" />
                            </div>
                            <h3 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                                AI Knowledge Hub
                            </h3>
                            <p style={{ fontSize: 15, maxWidth: 460, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
                                {docs.length === 0
                                    ? "Import documents to build your workspace intelligence."
                                    : "Ask questions, explore documents, and generate insights based on your imported data."}
                            </p>

                            {docs.length === 0 && (
                                <button onClick={() => fileRef.current?.click()} style={{
                                    marginTop: 24, padding: '12px 24px', background: 'var(--accent)', color: 'var(--bg-0)',
                                    border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 10, shadow: '0 10px 20px var(--accent-dim)'
                                }}>
                                    <UploadCloud size={18} /> Import First Document
                                </button>
                            )}
                        </div>
                    ) : (
                        <div style={{ paddingBottom: 40 }}>
                            {messages.map((m, i) => (
                                <div key={i} style={{
                                    padding: '32px 32px',
                                    background: m.role === 'assistant' ? 'var(--bg-1)' : 'transparent',
                                    borderBottom: '1px solid var(--border)',
                                    animation: 'fadeIn 0.3s ease both',
                                }}>
                                    <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', gap: 24 }}>
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                                            background: m.role === 'assistant' ? 'var(--accent)' : 'var(--bg-3)',
                                            color: m.role === 'assistant' ? 'var(--bg-0)' : 'var(--text-2)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            border: '1px solid var(--border)',
                                        }}>
                                            {m.role === 'user' ? <User size={18} strokeWidth={2.5} /> : <Sparkles size={18} strokeWidth={2.5} />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                                                {m.role === 'user' ? 'YOU' : 'VERO AI'}
                                            </div>
                                            <div style={{
                                                fontSize: 15, lineHeight: 1.75, color: m.role === 'error' ? 'var(--red)' : 'var(--text)',
                                                whiteSpace: 'pre-wrap', fontWeight: 450
                                            }}>
                                                {m.text}
                                            </div>

                                            {m.citations?.length > 0 && (
                                                <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                                                    {m.citations.map((c, idx) => (
                                                        <button key={idx} onClick={() => {
                                                            // Scroll right panel to doc or show preview
                                                        }} style={{
                                                            padding: '6px 14px', background: 'var(--bg-2)', border: '1px solid var(--border)',
                                                            borderRadius: 8, fontSize: 12, color: 'var(--text-3)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
                                                            transition: 'all 0.2s', borderStyle: 'dashed'
                                                        }}
                                                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)'; }}
                                                        >
                                                            <Info size={12} /> Source {idx + 1}: {c.doc_title}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {isStreaming && (
                                <div style={{ padding: '32px 32px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', gap: 24 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent)', color: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Sparkles size={18} strokeWidth={2.5} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>VERO AI</div>
                                            <div className="streaming-cursor" style={{ fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontWeight: 450 }}>
                                                {streamingText}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {searching && (
                                <div style={{ padding: '32px 32px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', gap: 24, alignItems: 'center' }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Loader2 size={18} className="spin" />
                                        </div>
                                        <div>
                                            <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 700, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                Thinking...
                                            </span>
                                            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, marginTop: 4 }}>
                                                Reading workspace documents and synthesizing response
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    )}
                </div>

                {/* Input Zone */}
                <div style={{ padding: '24px 32px', background: 'var(--bg-0)' }}>
                    <form onSubmit={send} style={{
                        maxWidth: 840, margin: '0 auto', position: 'relative',
                        background: 'var(--bg-2)', border: '1px solid var(--border)',
                        borderRadius: 20, padding: 8, paddingLeft: 16,
                        display: 'flex', alignItems: 'center', gap: 12,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                        transition: 'border-color 0.2s',
                        ...(docs.length === 0 ? { opacity: 0.6 } : {})
                    }}
                        onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
                        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                        <Sparkles size={20} color="var(--accent)" style={{ opacity: 0.8 }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            disabled={docs.length === 0 || searching || isStreaming}
                            placeholder={docs.length === 0 ? "Import documents to start..." : "Ask VERO about this workspace..."}
                            style={{
                                flex: 1, border: 'none', background: 'none', color: 'var(--text)',
                                padding: '12px 0', fontSize: 15, fontFamily: 'var(--font)',
                                outline: 'none', fontWeight: 500
                            }}
                        />
                        <button type="submit" disabled={!query.trim() || searching || isStreaming || docs.length === 0}
                            style={{
                                width: 44, height: 44, borderRadius: 16, border: 'none',
                                background: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--bg-3)' : 'var(--accent)',
                                color: 'var(--bg-0)', cursor: 'pointer', display: 'flex',
                                alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                            }}>
                            <ArrowUp size={22} strokeWidth={3} />
                        </button>
                    </form>
                    <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-4)', marginTop: 16, fontWeight: 600 }}>
                        VERO might produce hallucinated answers. Always verify critical information.
                    </p>
                </div>
            </div>

            {/* ═══════ RIGHT: Insight & Context ═══════ */}
            <div style={{
                width: 380, flexShrink: 0, background: 'var(--bg-1)',
                borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
            }}>
                {/* Drag-n-Drop / Upload Area (Top of Right Panel) */}
                <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{
                        margin: 20, padding: 24, borderRadius: 16, border: '2px dashed',
                        borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                        background: dragOver ? 'var(--accent-dim)' : 'var(--bg-2)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
                        position: 'relative', overflow: 'hidden'
                    }}>
                    <UploadCloud size={32} color={ingesting ? 'var(--accent)' : 'var(--text-4)'} style={{ marginBottom: 12 }} />
                    <h5 style={{ fontSize: 14, fontWeight: 750, color: 'var(--text)' }}>Import Documents</h5>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, marginTop: 4 }}>
                        {ingesting ? 'Processing sync...' : 'PDF, MD, TXT or DOCX'}
                    </p>
                    <input ref={fileRef} type="file" multiple onChange={e => ingestFile(e.target.files[0])} hidden />

                    {ingesting && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, height: 2, width: '100%', background: 'var(--accent)', animation: 'shimmer 1.5s infinite' }} />
                    )}
                </div>

                <div style={{ padding: '0 20px 12px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h4 style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Resource Knowledge
                        </h4>
                        <button onClick={fetchDocs} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 4 }}>
                            <RefreshCw size={14} className={docsLoading ? 'spin' : ''} />
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {docsLoading ? [1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 60, borderRadius: 12 }} />) :
                            docs.length === 0 ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)' }}>
                                    <FileArchive size={40} strokeWidth={1} style={{ marginBottom: 16, opacity: 0.3 }} />
                                    <p style={{ fontSize: 12 }}>Workspace is empty.</p>
                                </div>
                            ) :
                                docs.map(d => {
                                    const status = getPreciseStatus(d);
                                    const Icon = status.icon;
                                    const traces = docTraces[d.title] || [];

                                    return (
                                        <div key={d.id} style={{
                                            background: 'var(--bg-2)', padding: 16, borderRadius: 16,
                                            border: '1px solid var(--border)', animation: 'fadeIn 0.2s ease both'
                                        }}>
                                            <div style={{ display: 'flex', gap: 12 }}>
                                                <div style={{
                                                    width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                                }}>
                                                    <FileText size={16} color="var(--text-3)" />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {d.title}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                        <Icon size={12} color={status.color} className={status.label.includes('...') || status.label.includes('Step') ? 'spin' : ''} />
                                                        <span style={{ fontSize: 11, fontWeight: 600, color: status.color }}>{status.label}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Trace snippets if this doc was used in current chat */}
                                            {traces.length > 0 && (
                                                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-4)' }}>CITATIONS ({traces.length})</span>
                                                    {traces.map((r, idx) => (
                                                        <div key={idx} onClick={() => setActiveCitation(r.index)} style={{
                                                            padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                                                            background: activeCitation === r.index ? 'var(--accent-dim)' : 'var(--bg-0)',
                                                            border: '1px solid', borderColor: activeCitation === r.index ? 'var(--accent-border)' : 'var(--border)',
                                                            color: 'var(--text-3)', cursor: 'pointer', transition: 'all 0.1s'
                                                        }}>
                                                            <div style={{ fontSize: 10, fontWeight: 750, color: activeCitation === r.index ? 'var(--accent)' : 'var(--text-4)', marginBottom: 4 }}>
                                                                [{r.index + 1}] • {Math.round(r.score * 100)}% Match
                                                            </div>
                                                            <p style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                                {r.text}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                    </div>
                </div>
            </div>
        </div>
    );
}
