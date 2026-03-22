import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';
import {
    Send, Search, Loader2, FileText, ArrowUp, Sparkles,
    RefreshCw, User, Bot, CheckCircle2, UploadCloud, Globe,
    X, ChevronRight, ChevronDown, BookOpen, FileArchive, Wand2, Info, Layers, Clock, Edit2, Pin, Trash2, Cpu, Zap,
    FileType, AlignLeft, FileCode, Github, Link, Plus, PanelRightClose, PanelRightOpen, Square, Copy, Check, Pencil, Menu, Library, MessageSquare, Brain
} from 'lucide-react';

/**
 * Map of Unicode math symbols → LaTeX equivalents.
 * Covers Greek letters, operators, and notation commonly found in academic PDFs.
 */
const UNICODE_TO_LATEX = {
    // Lowercase Greek
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
    'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
    'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\varphi',
    'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    // Uppercase Greek
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
    'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
    'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
    // Math operators & relations
    '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∂': '\\partial',
    '∇': '\\nabla', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
    '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
    '∪': '\\cup', '∩': '\\cap', '∀': '\\forall', '∃': '\\exists',
    '∞': '\\infty', '≈': '\\approx', '≠': '\\neq', '≤': '\\leq',
    '≥': '\\geq', '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow',
    '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
    '×': '\\times', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
    '√': '\\sqrt', '∝': '\\propto', '⊗': '\\otimes', '⊕': '\\oplus',
    // Misc notation
    'ℝ': '\\mathbb{R}', 'ℤ': '\\mathbb{Z}', 'ℕ': '\\mathbb{N}',
    'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}',
};

/**
 * Detect and convert Unicode math patterns to LaTeX-wrapped expressions.
 * Simple, reliable strategy: find Unicode math symbols, expand to grab
 * surrounding math context, convert and wrap in $...$
 */
function postprocessMathForRendering(text) {
    if (!text) return text;

    // Quick check: any math symbols present at all?
    const mathSymbolPattern = /[α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ∗]/;
    if (!mathSymbolPattern.test(text)) return text;

    // Process line by line to skip code blocks
    const lines = text.split('\n');
    let inCodeBlock = false;

    const processed = lines.map(line => {
        if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; return line; }
        if (inCodeBlock) return line;
        if (line.trim().startsWith('$$')) return line;
        // Skip if line already has inline math
        if (/\$[^$]+\$/.test(line) && !mathSymbolPattern.test(line.replace(/\$[^$]+\$/g, ''))) return line;

        // Replace each Unicode math symbol (and its surrounding math context) with LaTeX
        // Strategy: match a "math token" — a Unicode symbol optionally surrounded by
        // letters/digits/subscripts/superscripts/parens/braces that form one expression
        let result = line.replace(
            /[({]?[a-zA-Z0-9_^∗*{}()\[\], =+\-/.]*[α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ∗][a-zA-Z0-9_^∗*{}()\[\], =+\-/.α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ]*[)}]?/g,
            (match) => {
                const trimmed = match.trim();
                if (!trimmed) return match;

                // Convert each Unicode symbol to its LaTeX command
                let latex = trimmed;
                for (const [sym, cmd] of Object.entries(UNICODE_TO_LATEX)) {
                    latex = latex.replaceAll(sym, cmd);
                }
                latex = latex.replace(/∗/g, '^*');

                const lead = match.match(/^\s*/)[0];
                const trail = match.match(/\s*$/)[0];
                return `${lead}$${latex.trim()}$${trail}`;
            }
        );

        return result;
    });

    return processed.join('\n');
}

/**
 * Full preprocessing pipeline for AI response text:
 * 1. Convert Unicode math to LaTeX
 * 2. Convert [Source N] / [N] citations to clickable markdown links
 */
function preprocessTextForMarkdown(text) {
    if (!text) return text;
    // Step 1: Convert Unicode math symbols to LaTeX
    let result = postprocessMathForRendering(text);
    // Step 2: [Source N] → [N](cite:N) for clickable citation bubbles
    result = result.replace(/\[Source\s+(\d+)\]/gi, (_, num) => `[${num}](cite:${num})`);
    // Step 3: standalone [N] not already linked → [N](cite:N)
    result = result.replace(/\[(\d+)\](?!\()/g, (_, num) => `[${num}](cite:${num})`);
    return result;
}

export default function WorkspacePage({ projectId, activeSessionId, setSessions, onRefreshProjects, isMobile, onOpenMobileMenu }) {
    // Project info
    const [project, setProject] = useState(null);
    const [sessionTitle, setSessionTitle] = useState('');

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
    const [activeCitationDoc, setActiveCitationDoc] = useState(null);
    const [activeCitationChunk, setActiveCitationChunk] = useState(null); // { srcNum, text, doc_title }
    const [openCitations, setOpenCitations] = useState(new Set()); // Message indices that have their citations accordion open
    const [modelKnowledge, setModelKnowledge] = useState(() => {
        const saved = localStorage.getItem('vero-model-knowledge');
        return saved === 'true';
    });

    // Chat Input UI State
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    const modelMenuRef = useRef(null);

    // Click-away listener for Model Menu
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
                setModelMenuOpen(false);
            }
        };
        if (modelMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [modelMenuOpen]);
    const [loadingText, setLoadingText] = useState('Analyzing sources...');
    const [rightPanelOpen, setRightPanelOpen] = useState(() => {
        const saved = localStorage.getItem('vero-right-panel');
        return saved !== null ? saved === 'true' : true;
    });

    // Persist right panel state
    useEffect(() => {
        localStorage.setItem('vero-right-panel', String(rightPanelOpen));
    }, [rightPanelOpen]);

    // Cycle loading text
    useEffect(() => {
        if (!searching) return;
        const texts = ['Analyzing sources...', 'Cross-referencing docs...', 'Synthesizing insights...', 'Formulating response...'];
        let i = 0;
        setLoadingText(texts[0]);
        const iv = setInterval(() => {
            i = (i + 1) % texts.length;
            setLoadingText(texts[i]);
        }, 1500);
        return () => clearInterval(iv);
    }, [searching]);

    const chatEndRef = useRef(null);
    const chatFeedRef = useRef(null);
    const fileRef = useRef(null);
    const isCreatingSession = useRef(false);
    const streamIntervalRef = useRef(null);

    // Auto-scroll to bottom on new messages and during streaming
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages, isStreaming]);
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
    const [projectSessions, setProjectSessions] = useState([]);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const sessionMenuRef = useRef(null);

    useEffect(() => {
        if (sessionMenuOpen && projectId) {
            setLoadingSessions(true);
            api.getSessions(projectId)
                .then(data => setProjectSessions(data))
                .catch(err => console.error(err))
                .finally(() => setLoadingSessions(false));
        }
    }, [sessionMenuOpen, projectId]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (sessionMenuOpen && sessionMenuRef.current && !sessionMenuRef.current.contains(e.target)) {
                setSessionMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [sessionMenuOpen]);

    const toast = useToast();
    const navigate = useNavigate();

    // Load project & docs on PID change
    useEffect(() => {
        if (projectId) {
            // Reset chat state immediately on project switch
            setMessages([]);
            setTraceResults([]);
            setStreamingText('');
            setIsStreaming(false);
            setSearching(false);

            loadProject();
            fetchDocs();
        }
        return () => {
            setSearching(false);
            setIsStreaming(false);
        };
    }, [projectId]);

    // Load session messages on SID change
    useEffect(() => {
        if (activeSessionId) {
            // Skip loading if we just created this session optimistic update
            if (isCreatingSession.current) {
                isCreatingSession.current = false;
                return;
            }
            loadSession(activeSessionId);
        } else {
            setMessages([]);
            setTraceResults([]);
            setStreamingText('');
            setIsStreaming(false);
            setSessionTitle('');
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
        try { setDocs((await api.getDocuments(projectId)) || []); }
        catch (e) { console.error(e); }
        finally { setDocsLoading(false); }
    };

    const loadSession = async (sid) => {
        try {
            const s = await api.getSession(sid);
            if (!s) throw new Error("Session not found");
            setSessionTitle(s.title || 'Chat');
            setMessages((s.messages || []).map(m => ({
                id: m.id,
                role: m.role,
                text: m.content,
                traces: m.citations || [],
                citations: m.citations || [],
                timestamp: m.created_at,
            })));
            // Reset trace/citations when switching sessions
            setTraceResults([]);
            setActiveCitationDoc(null);
        } catch (err) {
            toast?.('Failed to load conversation history.', 'error');
            navigate(`/p/${projectId}`);
        }
    };

    const handleDeleteProject = async () => {
        if (window.confirm('Are you sure you want to delete this workspace? This action cannot be undone.')) {
            try {
                await api.deleteProject(projectId);
                toast?.('Workspace deleted.', 'success');
                onRefreshProjects?.();
                navigate('/');
            } catch (err) {
                toast?.('Failed to delete workspace.', 'error');
            }
        }
    };

    const handleRenameProject = async () => {
        const newName = window.prompt('Rename workspace:', project?.name || '');
        if (!newName || newName.trim() === '' || newName.trim() === project?.name) return;
        try {
            await api.updateProject(projectId, { name: newName.trim() });
            setProject(prev => ({ ...prev, name: newName.trim() }));
            toast?.('Workspace renamed.', 'success');
            onRefreshProjects?.();
        } catch (err) {
            toast?.('Failed to rename workspace.', 'error');
        }
    };

    const handleRenameSession = async () => {
        const newTitle = window.prompt('Rename session:', sessionTitle || '');
        if (!newTitle || newTitle.trim() === '' || newTitle.trim() === sessionTitle) return;
        if (!activeSessionId) return;
        try {
            await api.renameSession(activeSessionId, newTitle.trim());
            setSessionTitle(newTitle.trim());
            if (setSessions) {
                setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, title: newTitle.trim() } : s));
            }
            toast?.('Session renamed.', 'success');
        } catch (err) {
            toast?.('Failed to rename session.', 'error');
        }
    };

    // ── Streaming simulation ─────────────────────────
    const streamText = (fullText, onChunk, onDone) => {
        setIsStreaming(true);
        const words = fullText.split(' ');
        let currentText = '';
        let i = 0;
        const iv = setInterval(() => {
            if (i < words.length) {
                // Stream 2-3 words at a time for natural speed
                const batch = Math.min(2, words.length - i);
                for (let b = 0; b < batch; b++) {
                    currentText += (i + b > 0 ? ' ' : '') + words[i + b];
                }
                i += batch;
                if (onChunk) onChunk(currentText);
            } else {
                clearInterval(iv);
                streamIntervalRef.current = null;
                setIsStreaming(false);
                if (onDone) onDone(fullText);
            }
        }, 25);
        streamIntervalRef.current = iv;
    };

    const pollStatus = (docTitle) => {
        let lastStatus = '';
        const iv = setInterval(async () => {
            try {
                const allDocs = await api.getDocuments(projectId);
                setDocs(allDocs);
                const doc = allDocs.find(d => d.title === docTitle);

                if (doc && doc.processing_status !== lastStatus) {
                    lastStatus = doc.processing_status;
                    if (doc.processing_status === 'ready') {
                        toast?.(`"${docTitle}" is ready for chat.`, 'success');
                        clearInterval(iv);
                    } else if (doc.processing_status === 'error' || doc.processing_status === 'failed') {
                        toast?.(`Failed to process "${docTitle}".`, 'error');
                        clearInterval(iv);
                    } else if (doc.processing_status.includes('/')) {
                        // Show progress steps like 1/3, 2/3...
                        toast?.(`Processing "${docTitle}": Step ${doc.processing_status}`, 'info');
                    }
                }
            } catch { clearInterval(iv); }
        }, 2500);
        setTimeout(() => clearInterval(iv), 180000);
    };

    // ── Ingestion ────────────────────────────────────
    const handleFiles = async (files) => {
        if (!files || files.length === 0 || !projectId) return;

        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'text/plain',
            'text/markdown',
            'text/csv'
        ];

        const validFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!allowedTypes.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
                toast?.(`Unsupported format: ${file.name}. Skipping.`, 'error');
                continue;
            }
            if (docs.some(d => d.title === file.name)) {
                toast?.(`"${file.name}" is already in this project. Skipping.`, 'info');
                continue;
            }
            validFiles.push(file);
        }

        if (validFiles.length === 0) return;

        setIngesting(true);
        if (validFiles.length > 1) {
            toast?.(`Uploading ${validFiles.length} files...`, 'info');
        } else {
            const shortName = validFiles[0].name.length > 20 ? validFiles[0].name.substring(0, 20) + '...' : validFiles[0].name;
            toast?.(`Uploading ${shortName}...`, 'info');
        }

        try {
            const uploadedDocs = [];
            for (const file of validFiles) {
                const doc = await api.ingestFile(projectId, file);
                uploadedDocs.push(doc);
            }
            if (fileRef.current) fileRef.current.value = '';
            await fetchDocs();
            uploadedDocs.forEach(doc => pollStatus(doc.title));
            onRefreshProjects?.();
        } catch (err) { toast?.('Import failed for some documents.', 'error'); }
        finally { setIngesting(false); }
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files?.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    }, [projectId, docs]);

    const handleUrlIngest = async (e) => {
        e.preventDefault();
        if (!url.trim() || !projectId) return;

        const isRepo = url.includes('github.com');
        const prefix = isRepo ? 'Repo' : 'Web';
        const cleanUrl = url.replace(/https?:\/\/(www\.)?/, '');
        const shortUrl = cleanUrl.length > 25 ? cleanUrl.substring(0, 25) + '...' : cleanUrl;

        if (docs.some(d => d.title === url || d.title.includes(cleanUrl))) {
            toast?.(`This link has already been added to this project.`, 'info');
            return;
        }

        setIngesting(true);
        toast?.(`${prefix} ${shortUrl} processing...`, 'info');
        try {
            const doc = await api.ingestUrl(projectId, url);
            setUrl(''); setShowUrl(false);
            await fetchDocs();
            pollStatus(doc.title);
            onRefreshProjects?.();
        } catch (err) { toast?.('Import failed', 'error'); }
        finally { setIngesting(false); }
    };

    // ── Chat ─────────────────────────────────────────
    const abortControllerRef = useRef(null);

    const send = async (e) => {
        e?.preventDefault();
        if (!query.trim() || !projectId || searching || isStreaming || docs.length === 0) return;

        const q = query.trim();
        setQuery('');
        const now = new Date().toISOString();
        setMessages(prev => [...prev, { role: 'user', text: q, timestamp: now }]);
        setSearching(true);
        setIsStreaming(true);
        setTraceResults([]); setActiveCitationDoc(null);

        // Cancel previous request if still running
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            let sid = activeSessionId;
            if (!sid) {
                isCreatingSession.current = true;
                const s = await api.createSession(projectId, q.substring(0, 40));
                sid = s.id;
                navigate(`/p/${projectId}/c/${sid}`, { replace: true });
                if (setSessions) setSessions(prev => [s, ...prev]);
                setSessionTitle(s.title || 'New Chat');
                onRefreshProjects?.();
            }

            // Create placeholder message
            setMessages(prev => [...prev, {
                role: 'assistant', text: '',
                citations: [], traces: [],
                thoughts: [], // Holds the agent's reasoning events
                isStreaming: true,
                timestamp: new Date().toISOString(),
                usedModelKnowledge: modelKnowledge,
            }]);

            // Real SSE Fetch
            const response = await fetch(`http://127.0.0.1:8000/sessions/${sid}/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: q, top_k: 5, mode: "hybrid", allow_model_knowledge: modelKnowledge }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error("Stream connection failed.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedData = '';

            setSearching(false);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                accumulatedData += decoder.decode(value, { stream: true });
                const lines = accumulatedData.split('\n');
                accumulatedData = lines.pop(); // Keep the last incomplete line

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === '[DONE]') break;
                        
                        try {
                            const event = JSON.parse(dataStr);
                            handleAgentEvent(event);
                        } catch (e) {
                            console.error("Failed to parse SSE event:", e);
                        }
                    }
                }
            }
            
            // Note: isStreaming is set to false by the 'done' event handler
            // (with a delay to let streamText finish its animation)

        } catch (err) {
            if (err.name !== 'AbortError') {
                setMessages(prev => [...prev, { role: 'error', text: 'Issues connecting to VERO intelligence.', timestamp: new Date().toISOString() }]);
            }
            setSearching(false);
            setIsStreaming(false);
        }
    };

    const handleAgentEvent = (event) => {
        if (event.type === 'thinking' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'error') {
            // Build a human-readable thought content
            let displayContent = event.content;
            if (event.type === 'tool_call') {
                const toolName = event.metadata?.tool_name;
                const arg = event.metadata?.argument;
                if (toolName === 'search_docs') displayContent = `Searching documents for "${arg}"`;
                else if (toolName === 'read_document') displayContent = `Reading document: ${arg}`;
                else if (toolName === 'list_documents') displayContent = 'Listing available documents...';
            }
            if (event.type === 'tool_result') {
                const toolName = event.metadata?.tool_name;
                if (toolName === 'search_docs') {
                    const count = event.metadata?.result_count || 0;
                    displayContent = `Found ${count} relevant passage${count !== 1 ? 's' : ''}`;
                } else if (toolName === 'list_documents') {
                    const count = event.metadata?.doc_count || 0;
                    displayContent = `Found ${count} document${count !== 1 ? 's' : ''} in project`;
                }
            }

            setMessages(prev => {
                const next = [...prev];
                const msgObj = next[next.length - 1];
                const newThoughts = [...(msgObj.thoughts || []), { ...event, content: displayContent }];
                
                // If this is a search tool result, append traces in order so [Source N] maps to traces[N-1]
                let updatedTraces = msgObj.traces || [];
                if (event.type === 'tool_result' && event.metadata?.tool_name === 'search_docs' && Array.isArray(event.metadata?.results)) {
                    updatedTraces = [...updatedTraces, ...event.metadata.results];
                    setTraceResults(updatedTraces);
                }

                next[next.length - 1] = { ...msgObj, thoughts: newThoughts, traces: updatedTraces };
                return next;
            });
        } 
        else if (event.type === 'answer') {
            // Use the existing streamText to simulate word-by-word typing
            const fullAnswer = event.content || '';
            streamText(fullAnswer,
                (chunk) => {
                    setMessages(prev => {
                        const next = [...prev];
                        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], text: chunk };
                        return next;
                    });
                },
                (finalText) => {
                    setMessages(prev => {
                        const next = [...prev];
                        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], text: finalText };
                        return next;
                    });
                }
            );
        }
        else if (event.type === 'done') {
            // Apply the final sanitized answer + citations after streaming finishes
            // Wait for streamText to complete before applying final state
            const applyDone = () => {
                setMessages(prev => {
                    const next = [...prev];
                    const msgObj = next[next.length - 1];
                    // Use citations from the done event as the authoritative trace list
                    // These are properly filtered and re-indexed by the backend
                    const finalCitations = event.metadata?.citations;
                    const finalTraces = (Array.isArray(finalCitations) && finalCitations.length > 0) 
                        ? finalCitations 
                        : msgObj.traces || [];
                    next[next.length - 1] = { 
                        ...msgObj, 
                        isStreaming: false,
                        text: event.content || msgObj.text,
                        traces: finalTraces,
                        citations: finalCitations || [],
                        sufficient: event.metadata?.found_sufficient_info ?? msgObj.sufficient ?? true
                    };
                    return next;
                });
                setTraceResults(prev => {
                    // Also update global trace state
                    const finalCitations = event.metadata?.citations;
                    return (Array.isArray(finalCitations) && finalCitations.length > 0) ? finalCitations : prev;
                });
                setIsStreaming(false);
            };
            // Poll until streamText is done (streamIntervalRef becomes null)
            const waitForStream = setInterval(() => {
                if (!streamIntervalRef.current) {
                    clearInterval(waitForStream);
                    applyDone();
                }
            }, 100);
            // Safety: apply after 15s max regardless
            setTimeout(() => { clearInterval(waitForStream); applyDone(); }, 15000);
        }
    };

    const stopGenerating = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setIsStreaming(false);
        setSearching(false);
        setMessages(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].isStreaming) {
                next[next.length - 1] = { ...next[next.length - 1], isStreaming: false, stopped: true };
            }
            return next;
        });
    };

    const copyMessage = (text, index) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        });
    };

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${date}, ${time}`;
    };

    const deleteMessagePair = async (msgIndex) => {
        const msg = messages[msgIndex];
        // If this is a user message, find its corresponding AI response
        const userIdx = msg.role === 'user' ? msgIndex : msgIndex - 1;
        const aiIdx = msg.role === 'user' ? msgIndex + 1 : msgIndex;
        const userMsg = messages[userIdx];
        const aiMsg = messages[aiIdx];

        // Determine which message ID to send to backend
        const targetId = userMsg?.id || aiMsg?.id;

        if (targetId && activeSessionId) {
            try {
                await api.deleteMessagePair(activeSessionId, targetId);
            } catch (err) {
                toast?.('Failed to delete message.', 'error');
                return;
            }
        }

        // Remove both messages from UI state
        setMessages(prev => {
            const next = [...prev];
            const removeIndices = new Set();
            if (userIdx >= 0 && userIdx < next.length && next[userIdx]?.role === 'user') removeIndices.add(userIdx);
            if (aiIdx >= 0 && aiIdx < next.length && (next[aiIdx]?.role === 'assistant' || next[aiIdx]?.role === 'error')) removeIndices.add(aiIdx);
            return next.filter((_, idx) => !removeIndices.has(idx));
        });
        toast?.('Message deleted.', 'success');
    };

    const getPreciseStatus = (doc) => {
        const s = doc.processing_status;
        if (s === 'ready') return { label: 'Knowledge Ready', color: 'var(--green)', icon: CheckCircle2 };
        if (s === 'pending') return { label: 'In Queue', color: 'var(--text-4)', icon: Clock };
        if (s === 'processing' || s === 'chunking') return { label: 'Step 1/2: Chunking & Indexing', color: 'var(--accent)', icon: Loader2 };
        if (s === 'embedding') return { label: 'Step 2/2: Vectorizing Context', color: 'var(--accent)', icon: Loader2 };
        if (s === 'error' || s === 'failed') return { label: 'Sync Failed', color: 'var(--red)', icon: X };
        return { label: 'In Queue', color: 'var(--text-4)', icon: Clock };
    };

    if (!projectId) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', background: 'var(--bg-0)' }}>
                <Layers size={48} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.2 }} />
                <p style={{ fontSize: 16, color: 'var(--text-3)', fontWeight: 500 }}>Select a workspace to begin</p>
            </div>
        );
    }

    const isFile = (t) => {
        const ext = t?.toLowerCase() || '';
        return ext.endsWith('.pdf') || ext.endsWith('.doc') || ext.endsWith('.docx') || ext.endsWith('.txt') || ext.endsWith('.md') || ext.endsWith('.csv');
    };

    // ── Document type icon helper ─────────────────────
    const getDocIcon = (title) => {
        const t = title?.toLowerCase() || '';
        if (t.endsWith('.pdf')) return { icon: FileText, color: 'var(--red)' };
        if (t.endsWith('.doc') || t.endsWith('.docx')) return { icon: FileType, color: '#2b579a' };
        if (t.endsWith('.txt')) return { icon: AlignLeft, color: 'var(--text-2)' };
        if (t.endsWith('.md')) return { icon: FileCode, color: '#e34c26' };
        if (t.includes('github')) return { icon: Github, color: 'var(--text)' };
        if (!isFile(t)) return { icon: Globe, color: 'var(--accent)' };
        return { icon: FileArchive, color: 'var(--text-4)' };
    };
    const lastActive = project?.updated_at ? new Date(project.updated_at).toLocaleDateString() : 'Active Now';

    // Pre-calculate traces by doc
    const docTraces = {};
    traceResults.forEach((r, i) => {
        if (!docTraces[r.doc_title]) docTraces[r.doc_title] = [];
        docTraces[r.doc_title].push({ ...r, index: i });
    });

    // ── Pre-process Text for ReactMarkdown Citations ────────────────
    const preprocessTextForMarkdown = (text) => {
        if (!text) return '';

        // This regex aggressively looks for bracketed numbers like [Source 1], [1], [Sources 1, 2], [1 and 2]
        const citationPattern = /\[(?:Sources?\s*)?((?:\d+(?:,\s*|\s+and\s+)*)+)\]/gi;

        return text.replace(citationPattern, (match, numbersStr) => {
            const numbers = numbersStr.match(/\d+/g);
            if (numbers) {
                // Convert to a custom markdown link that we'll intercept in the Custom Components
                return numbers.map(n => `[${n}](cite:${n})`).join(' ');
            }
            return match;
        });
    };

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

            {/* ═══════ CENTER: Main Chat ═══════ */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

                {/* Workspace Header — SOTA Minimal */}
                <header style={{
                    padding: '0 20px', height: 60, borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    zIndex: 10, position: 'sticky', top: 0,
                    backdropFilter: 'blur(30px)', background: 'var(--bg-glass)',
                    gap: 12, flexShrink: 0
                }}>
                    {/* Left: Navigation + Title */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        {isMobile && (
                            <button className="hamburger-btn" onClick={onOpenMobileMenu} title="Open Menu" style={{
                                width: 34, height: 34, borderRadius: 8, border: 'none',
                                background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                            }}>
                                <Menu size={18} />
                            </button>
                        )}
                        {/* Project chip */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                            background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--border)',
                            flexShrink: 0, maxWidth: isMobile ? 120 : 200
                        }}>
                            <Layers size={12} color="var(--accent)" style={{ flexShrink: 0 }} />
                            <span style={{
                                fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                            }}>
                                {project?.name || 'Workspace'}
                            </span>
                        </div>
                        {/* Separator */}
                        <ChevronRight size={14} color="var(--text-4)" style={{ flexShrink: 0 }} />

                        {/* Session dropdown container */}
                        <div ref={sessionMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            <div
                                onClick={() => setSessionMenuOpen(!sessionMenuOpen)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    cursor: 'pointer', minWidth: 0, padding: '4px 8px',
                                    borderRadius: 6, transition: 'background 0.15s ease'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <span
                                    title={sessionTitle || 'New Chat'}
                                    style={{
                                        fontSize: 14, fontWeight: 600, color: 'var(--text)',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        letterSpacing: '-0.01em',
                                    }}
                                >
                                    {sessionTitle || 'New Chat'}
                                </span>
                                <ChevronDown size={14} color="var(--text-4)" />
                            </div>

                            {/* Dropdown Menu */}
                            {sessionMenuOpen && (
                                <div
                                    style={{
                                        position: isMobile ? 'fixed' : 'absolute',
                                        top: isMobile ? 64 : '100%',
                                        left: isMobile ? 12 : 0,
                                        right: isMobile ? 12 : 'auto',
                                        marginTop: isMobile ? 0 : 8,
                                        width: isMobile ? 'auto' : 280,
                                        background: 'var(--bg-0)',
                                        border: '1px solid var(--border)', borderRadius: 12,
                                        boxShadow: '0 12px 32px rgba(0,0,0,0.15)', zIndex: 100,
                                        display: 'flex', flexDirection: 'column', overflow: 'hidden'
                                    }}
                                >
                                    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-1)' }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>All Sessions</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSessionMenuOpen(false); navigate(`/p/${projectId}`); }}
                                            style={{
                                                background: 'var(--accent)', color: 'var(--bg-0)', border: 'none',
                                                borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                                            }}
                                        >
                                            <Plus size={12} strokeWidth={3} /> New
                                        </button>
                                    </div>
                                    <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: 8, gap: 4 }}>
                                        {loadingSessions ? (
                                            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-4)' }}><Loader2 size={16} className="spin" /></div>
                                        ) : projectSessions.length === 0 && !activeSessionId ? (
                                            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>No existing sessions</div>
                                        ) : (
                                            projectSessions.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).map(s => (
                                                <div
                                                    key={s.id}
                                                    onClick={() => { setSessionMenuOpen(false); navigate(`/p/${projectId}/c/${s.id}`); }}
                                                    style={{
                                                        padding: '10px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
                                                        cursor: 'pointer', background: s.id === activeSessionId ? 'var(--bg-2)' : 'transparent',
                                                        color: s.id === activeSessionId ? 'var(--text)' : 'var(--text-2)',
                                                        position: 'relative'
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.background = s.id === activeSessionId ? 'var(--bg-2)' : 'var(--bg-hover)';
                                                        const actions = e.currentTarget.querySelector('.session-actions');
                                                        if (actions) actions.style.opacity = '1';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.background = s.id === activeSessionId ? 'var(--bg-2)' : 'transparent';
                                                        const actions = e.currentTarget.querySelector('.session-actions');
                                                        if (actions) actions.style.opacity = '0';
                                                    }}
                                                >
                                                    <MessageSquare size={14} color={s.id === activeSessionId ? 'var(--accent)' : 'var(--text-4)'} fill={s.id === activeSessionId ? 'var(--accent-dim)' : 'transparent'} style={{ flexShrink: 0 }} />
                                                    <span style={{ fontSize: 13, fontWeight: s.id === activeSessionId ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{s.title || 'Untitled Session'}</span>

                                                    {/* Inline Actions (visible on hover) */}
                                                    <div className="session-actions" style={{
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        opacity: 0, transition: 'opacity 0.2s', flexShrink: 0
                                                    }}>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); setSessionMenuOpen(false); handleRenameSession(s.id, projectId, s.title); }}
                                                            style={{
                                                                background: 'transparent', border: 'none', color: 'var(--text-4)',
                                                                padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center',
                                                                transition: 'all 0.15s ease'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-4)'; }}
                                                            title="Rename"
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                        <button
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                if (window.confirm('Delete this conversation?')) {
                                                                    api.deleteSession(s.id).then(() => {
                                                                        setProjectSessions(prev => prev.filter(x => x.id !== s.id));
                                                                        if (s.id === activeSessionId) navigate(`/p/${projectId}`);
                                                                    });
                                                                }
                                                            }}
                                                            style={{
                                                                background: 'transparent', border: 'none', color: 'var(--text-4)',
                                                                padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center',
                                                                transition: 'all 0.15s ease'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-4)'; }}
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Compact action strip */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        {/* Sources panel toggle with badge */}
                        <button
                            title={rightPanelOpen ? 'Hide Sources' : 'Show Sources'}
                            onClick={() => setRightPanelOpen(p => !p)}
                            style={{
                                height: 36, borderRadius: 10, border: 'none',
                                padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                                background: rightPanelOpen ? 'var(--accent-dim)' : 'transparent',
                                color: rightPanelOpen ? 'var(--accent)' : 'var(--text-4)',
                                cursor: 'pointer', transition: 'all 0.2s ease', fontSize: 13, fontWeight: 700
                            }}
                            onMouseEnter={e => { if (!rightPanelOpen) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; } }}
                            onMouseLeave={e => { if (!rightPanelOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-4)'; } }}
                        >
                            <Library size={16} />
                            {docs.length > 0 && (
                                <span style={{
                                    fontSize: 11, fontWeight: 800,
                                    background: rightPanelOpen ? 'var(--accent)' : 'var(--bg-0)',
                                    color: rightPanelOpen ? 'var(--bg-0)' : 'var(--accent)',
                                    border: `1.5px solid ${rightPanelOpen ? 'transparent' : 'var(--accent)'}`,
                                    borderRadius: 14, padding: '2px 8px',
                                    lineHeight: '1', minWidth: 24, textAlign: 'center',
                                    letterSpacing: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 20,
                                    boxShadow: rightPanelOpen ? 'none' : '0 2px 8px var(--accent-dim)'
                                }}>
                                    {docs.length}
                                </span>
                            )}
                        </button>
                    </div>
                </header>

                {/* Main Header End */}

                {/* Chat Feed */}
                <div ref={chatFeedRef} className="chat-feed" style={{ flex: 1, overflowY: 'auto', scrollPaddingBottom: 100 }}>
                    {messages.length === 0 && !searching && !isStreaming ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: 16, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20
                            }}>
                                <img src="/vero.svg" alt="VERO" style={{ width: 32, height: 32, objectFit: 'contain' }} />
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
                                    display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 20px var(--accent-dim)'
                                }}>
                                    <UploadCloud size={18} /> Import First Document
                                </button>
                            )}
                        </div>
                    ) : (
                        <div style={{ paddingBottom: 40, padding: '32px 32px' }}>
                            {messages.map((m, i) => (
                                <div key={i} className={`chat-message ${m.role === 'user' ? 'chat-message-user' : ''}`} style={{
                                    maxWidth: 840, margin: '0 auto',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    marginBottom: 32,
                                }}>
                                    {m.role === 'assistant' || m.role === 'error' ? (
                                        <div className="ai-message-container" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                            {/* AI Header: Avatar + VERO + Status */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                                {/* VERO Avatar — Pulsing glow when streaming */}
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: 12, flexShrink: 0,
                                                    background: m.isStreaming 
                                                        ? 'linear-gradient(135deg, var(--accent-dim), var(--accent))'
                                                        : 'var(--accent-dim)',
                                                    border: `1.5px solid ${m.isStreaming ? 'var(--accent)' : 'var(--accent-border)'}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    boxShadow: m.isStreaming ? '0 0 20px var(--accent-dim), 0 0 40px rgba(99, 102, 241, 0.1)' : 'var(--shadow-sm)',
                                                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                                                    animation: m.isStreaming ? 'pulse 2s ease-in-out infinite' : 'none',
                                                }}>
                                                    <img src="/vero.svg" alt="V" style={{ width: 16, height: 16, objectFit: 'contain' }} />
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '0.02em' }}>VERO</span>
                                                    {m.isStreaming && (
                                                        <span style={{
                                                            fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                                                            background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: 100,
                                                            letterSpacing: '0.05em', textTransform: 'uppercase',
                                                            animation: 'pulse 1.5s ease-in-out infinite'
                                                        }}>LIVE</span>
                                                    )}
                                                    {m.timestamp && !m.isStreaming && <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 500 }}>{formatTimestamp(m.timestamp)}</span>}
                                                    {m.stopped && <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, background: 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', borderRadius: 100 }}>STOPPED</span>}
                                                    {m.usedModelKnowledge && (
                                                        <div className="ai-knowledge-badge" title="This response leveraged the AI's built-in model knowledge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                                                            <Sparkles size={11} color="rgb(168, 85, 247)" />
                                                            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgb(168, 85, 247)', letterSpacing: '0.03em' }}>MODEL KNOWLEDGE</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Content / Text */}
                                            <div className="ai-message-content" style={{ paddingLeft: 46, width: '100%' }}>
                                                
                                                {/* Agent Thought Process (Collapsible) */}
                                                {m.thoughts && m.thoughts.length > 0 && (() => {
                                                    const isAccordionOpen = !m.thoughtAccordionClosed;
                                                    const isThinking = m.isStreaming && m.text.length === 0;
                                                    
                                                    return (
                                                        <div style={{ marginBottom: 20 }}>
                                                            {/* Accordion Toggle — Glassmorphic Pill */}
                                                            <div 
                                                                onClick={() => {
                                                                    setMessages(prev => {
                                                                        const next = [...prev];
                                                                        next[i] = { ...next[i], thoughtAccordionClosed: !next[i].thoughtAccordionClosed };
                                                                        return next;
                                                                    });
                                                                }}
                                                                style={{ 
                                                                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 16px 7px 10px',
                                                                    background: isThinking 
                                                                        ? 'linear-gradient(135deg, var(--bg-3), var(--bg-2))' 
                                                                        : (isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)'),
                                                                    border: '1px solid', 
                                                                    borderColor: isThinking ? 'var(--accent-border)' : (isAccordionOpen ? 'var(--border)' : 'var(--border)'),
                                                                    borderRadius: 100, cursor: 'pointer', userSelect: 'none',
                                                                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                    boxShadow: isThinking ? '0 0 16px var(--accent-dim)' : 'none',
                                                                }}
                                                                onMouseEnter={e => { if (!isThinking) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
                                                                onMouseLeave={e => { if (!isThinking) { e.currentTarget.style.background = isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)'; e.currentTarget.style.borderColor = isAccordionOpen ? 'var(--border)' : 'var(--border)'; } }}
                                                            >
                                                                <div style={{ position: 'relative', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    {isThinking && (
                                                                        <div style={{ 
                                                                            position: 'absolute', width: '100%', height: '100%', borderRadius: '50%',
                                                                            border: '2px solid var(--accent)', borderRightColor: 'transparent',
                                                                            animation: 'spin 0.8s linear infinite',
                                                                            opacity: 0.7
                                                                        }} />
                                                                    )}
                                                                    <Brain size={14} color={isThinking ? 'var(--accent)' : 'var(--text-3)'} strokeWidth={2.5} />
                                                                </div>
                                                                <span style={{ fontSize: 13, fontWeight: 700, color: isThinking ? 'var(--accent)' : 'var(--text-3)', letterSpacing: '0.01em' }}>
                                                                    {isThinking ? 'Reasoning...' : `${m.thoughts.length} reasoning steps`}
                                                                </span>
                                                                <ChevronDown size={14} color="var(--text-4)" style={{ marginLeft: 2, transform: isAccordionOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}/>
                                                            </div>
                                                            
                                                            {/* Thought Steps List */}
                                                            <div style={{
                                                                display: 'grid', gridTemplateRows: isAccordionOpen ? '1fr' : '0fr',
                                                                transition: 'grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
                                                            }}>
                                                                <div style={{ overflow: 'hidden' }}>
                                                                    <div style={{ 
                                                                        marginTop: 14, marginLeft: 22, paddingLeft: 18, 
                                                                        borderLeft: '2px solid var(--accent-border)',
                                                                        display: 'flex', flexDirection: 'column', gap: 0,
                                                                        opacity: isAccordionOpen ? 1 : 0, 
                                                                        transform: isAccordionOpen ? 'translateY(0)' : 'translateY(-8px)',
                                                                        transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                    }}>
                                                                        {m.thoughts.map((t, idx) => {
                                                                            let icon = <Brain size={13} color="var(--text-4)" />;
                                                                            let iconBg = 'var(--bg-1)';
                                                                            let iconBorder = 'var(--border)';
                                                                            if (t.type === 'tool_call') {
                                                                                icon = <Search size={13} color="var(--accent)" />;
                                                                                iconBg = 'var(--accent-dim)';
                                                                                iconBorder = 'var(--accent-border)';
                                                                                if (t.metadata?.tool_name === 'read_document') icon = <BookOpen size={13} color="var(--accent)" />;
                                                                            }
                                                                            if (t.type === 'tool_result') { 
                                                                                icon = <CheckCircle2 size={13} color="var(--green)" />; 
                                                                                iconBg = 'rgba(34, 197, 94, 0.08)'; 
                                                                                iconBorder = 'rgba(34, 197, 94, 0.2)'; 
                                                                            }
                                                                            if (t.type === 'error') { icon = <X size={13} color="var(--red)" />; iconBg = 'rgba(239, 68, 68, 0.08)'; iconBorder = 'rgba(239, 68, 68, 0.2)'; }
                                                                            
                                                                            return (
                                                                                <div key={idx} style={{ 
                                                                                    display: 'flex', gap: 12, alignItems: 'center',
                                                                                    padding: '8px 0',
                                                                                }}>
                                                                                    {/* Timeline Node */}
                                                                                    <div style={{ 
                                                                                        width: 26, height: 26, borderRadius: '50%', 
                                                                                        background: iconBg,
                                                                                        border: `1.5px solid ${iconBorder}`, 
                                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                        marginLeft: -31, zIndex: 2, flexShrink: 0,
                                                                                    }}>
                                                                                        {icon}
                                                                                    </div>
                                                                                    <span style={{ 
                                                                                        fontSize: 13, color: t.type === 'tool_result' ? 'var(--text-2)' : 'var(--text-3)', 
                                                                                        lineHeight: 1.5, fontWeight: t.type === 'tool_call' ? 600 : 400,
                                                                                    }}>
                                                                                        {t.content}
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                <div className={`vero-md ${m.isStreaming && m.text.length > 0 ? "streaming-cursor" : ""}`} style={{
                                                    color: m.role === 'error' ? 'var(--red)' : 'var(--text)'
                                                }}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkMath]}
                                                        rehypePlugins={[rehypeKatex]}
                                                        urlTransform={(value) => {
                                                            if (value.startsWith('cite:')) return value;
                                                            // Provide a simple default transform for other URLs if needed,
                                                            // or rely on ReactMarkdown's default behavior for legitimate links.
                                                            return value.replace(/^javascript:/i, ''); // basic XSS prevention
                                                        }}
                                                        components={{
                                                            code({ node, inline, className, children, ...props }) {
                                                                const match = /language-(\w+)/.exec(className || '');
                                                                return !inline && match ? (
                                                                    <div style={{ position: 'relative', marginTop: 12, marginBottom: 16 }}>
                                                                        <div style={{
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                            background: 'var(--bg-3)', padding: '6px 14px',
                                                                            borderTopLeftRadius: 8, borderTopRightRadius: 8,
                                                                            border: '1px solid var(--border)', borderBottom: 'none'
                                                                        }}>
                                                                            <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                                                {match[1]}
                                                                            </span>
                                                                            <button
                                                                                onClick={() => { navigator.clipboard.writeText(String(children).replace(/\n$/, '')); /* Optional: toast here */ }}
                                                                                style={{
                                                                                    background: 'none', border: 'none', color: 'var(--text-4)',
                                                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                                                                    fontSize: 13, fontWeight: 500, padding: '6px 10px', borderRadius: 4,
                                                                                    transition: 'all 0.15s ease'
                                                                                }}
                                                                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                                                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                                            >
                                                                                <Copy size={15} /> Copy
                                                                            </button>
                                                                        </div>
                                                                        <pre style={{
                                                                            margin: 0, padding: '16px 20px', background: 'var(--bg-1)',
                                                                            overflowX: 'auto', borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                                                                            border: '1px solid var(--border)'
                                                                        }}>
                                                                            <code className={className} {...props} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-2)' }}>
                                                                                {children}
                                                                            </code>
                                                                        </pre>
                                                                    </div>
                                                                ) : (
                                                                    <code className={className} {...props} style={{ background: 'var(--bg-1)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.85em', color: 'var(--accent)' }}>
                                                                        {children}
                                                                    </code>
                                                                );
                                                            },
                                                            p({ children }) {
                                                                return <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>{children}</p>;
                                                            },
                                                            a: ({ node, href, children, ...props }) => {
                                                                if (href && href.startsWith('cite:')) {
                                                                    const num = parseInt(href.replace('cite:', ''));
                                                                    const trace = m.traces?.[num - 1];
                                                                    if (!trace) return <span style={{ opacity: 0.5 }}>[{num}]</span>;

                                                                    const isChunkActive = activeCitationChunk?.srcNum === num;

                                                                    return (
                                                                        <span
                                                                            onClick={() => {
                                                                                setActiveCitationChunk(isChunkActive ? null : { srcNum: num, text: trace.text, doc_title: trace.doc_title, score: trace.score });
                                                                                setActiveCitationDoc(trace.doc_title);
                                                                                if (!rightPanelOpen) setRightPanelOpen(true);
                                                                                setTimeout(() => {
                                                                                    const el = document.getElementById(`doc-${trace.doc_title}`);
                                                                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                }, 100);
                                                                            }}
                                                                            title={`From: ${trace.doc_title}`}
                                                                            style={{
                                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                                padding: '0 7px', margin: '0 3px', borderRadius: 5, minWidth: 20,
                                                                                background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                                border: '1px solid var(--accent-border)',
                                                                                color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                                fontSize: 11, fontWeight: 800,
                                                                                cursor: 'pointer', lineHeight: '20px',
                                                                                verticalAlign: 'middle', transition: 'all 0.15s ease',
                                                                                textDecoration: 'none'
                                                                            }}
                                                                            onMouseEnter={e => { if (!isChunkActive) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--bg-0)'; } }}
                                                                            onMouseLeave={e => { if (!isChunkActive) { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; } }}
                                                                        >
                                                                            {num}
                                                                        </span>
                                                                    );
                                                                }
                                                                return <a href={href} target="_blank" rel="noopener noreferrer" {...props} style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>;
                                                            }
                                                        }}
                                                    >
                                                        {preprocessTextForMarkdown(m.text)}
                                                    </ReactMarkdown>
                                                </div>

                                                {/* Message Actions */}
                                                {!m.isStreaming && m.role === 'assistant' && (
                                                    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
                                                        <button
                                                            onClick={() => copyMessage(m.text, i)}
                                                            title="Copy response"
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 4,
                                                                padding: '4px 8px', borderRadius: 6, border: 'none',
                                                                background: 'transparent', color: copiedIndex === i ? 'var(--green)' : 'var(--text-4)',
                                                                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                                                                transition: 'all 0.15s ease'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = copiedIndex === i ? 'var(--green)' : 'var(--text-4)'; }}
                                                        >
                                                            {copiedIndex === i ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Grouped Source Documents (Collapsible Accordion) */}
                                                {!m.isStreaming && m.traces?.length > 0 && (() => {
                                                    const grouped = {};
                                                    m.traces.forEach((t, idx) => {
                                                        if (!grouped[t.doc_title]) grouped[t.doc_title] = { title: t.doc_title, items: [] };
                                                        grouped[t.doc_title].items.push({ ...t, srcNum: idx + 1 });
                                                    });
                                                    const docList = Object.values(grouped);
                                                    const isAccordionOpen = openCitations.has(i);

                                                    return (
                                                        <div style={{ marginTop: 20 }}>
                                                            {/* Accordion Toggle */}
                                                            <div
                                                                onClick={() => setOpenCitations(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(i)) next.delete(i); else next.add(i);
                                                                    return next;
                                                                })}
                                                                style={{
                                                                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 8px',
                                                                    background: isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)',
                                                                    border: '1px solid', borderColor: isAccordionOpen ? 'var(--border)' : 'transparent',
                                                                    borderRadius: 100, cursor: 'pointer', userSelect: 'none',
                                                                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                }}
                                                                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)'; e.currentTarget.style.borderColor = isAccordionOpen ? 'var(--border)' : 'transparent'; }}
                                                            >
                                                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                                                                    <BookOpen size={12} strokeWidth={2.5} />
                                                                </div>
                                                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>
                                                                    {m.traces.length} {m.traces.length === 1 ? 'Source' : 'Sources'} Cited
                                                                </span>
                                                                <ChevronDown size={14} color="var(--text-4)" style={{ marginLeft: 4, transform: isAccordionOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }} />
                                                            </div>

                                                            {/* Accordion Content (CSS Grid Animation) */}
                                                            <div style={{
                                                                display: 'grid', gridTemplateRows: isAccordionOpen ? '1fr' : '0fr',
                                                                transition: 'grid-template-rows 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                                                            }}>
                                                                <div style={{ overflow: 'hidden' }}>
                                                                    <div style={{
                                                                        marginTop: 12, padding: '14px 16px', borderRadius: 12,
                                                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                                                        display: 'flex', flexDirection: 'column', gap: 6,
                                                                        opacity: isAccordionOpen ? 1 : 0, transform: isAccordionOpen ? 'translateY(0)' : 'translateY(-10px)',
                                                                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                    }}>
                                                                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                                                            Extracted References
                                                                        </div>
                                                                        {docList.map((doc, di) => {
                                                                            const isActive = activeCitationDoc === doc.title;
                                                                            return (
                                                                                <div key={di} onClick={() => {
                                                                                    setActiveCitationDoc(isActive ? null : doc.title);
                                                                                    if (!isActive) setTimeout(() => {
                                                                                        const el = document.getElementById(`doc-${doc.title}`);
                                                                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                    }, 50);
                                                                                }} style={{
                                                                                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                                                                    borderRadius: 10, cursor: 'pointer',
                                                                                    background: isActive ? 'var(--accent-dim)' : 'var(--bg-1)',
                                                                                    border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                                                                                    transition: 'all 0.2s ease'
                                                                                }}
                                                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                                                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-1)'; }}
                                                                                >
                                                                                    <FileText size={14} color={isActive ? 'var(--accent)' : 'var(--text-4)'} />
                                                                                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isActive ? 'var(--text)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                        {doc.title}
                                                                                    </span>
                                                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                                                        {doc.items.map(item => {
                                                                                            const isChunkActive = activeCitationChunk?.srcNum === item.srcNum;
                                                                                            return (
                                                                                                <span key={item.srcNum}
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setActiveCitationChunk(isChunkActive ? null : { srcNum: item.srcNum, text: item.text, doc_title: item.doc_title, score: item.score });
                                                                                                        setActiveCitationDoc(item.doc_title);
                                                                                                        if (!isChunkActive) setTimeout(() => {
                                                                                                            const el = document.getElementById(`doc-${item.doc_title}`);
                                                                                                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                                        }, 50);
                                                                                                    }}
                                                                                                    style={{
                                                                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                                                        padding: '0 7px', margin: '0 2px', borderRadius: 5, minWidth: 20, height: 20,
                                                                                                        background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                                                        border: '1px solid var(--accent-border)',
                                                                                                        color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                                                        fontSize: 11, fontWeight: 800,
                                                                                                        cursor: 'pointer', lineHeight: '20px',
                                                                                                        transition: 'all 0.15s ease'
                                                                                                    }}
                                                                                                    onMouseEnter={e => {
                                                                                                        if (!isChunkActive) {
                                                                                                            e.currentTarget.style.background = 'var(--accent)';
                                                                                                            e.currentTarget.style.color = 'var(--bg-0)';
                                                                                                        }
                                                                                                    }}
                                                                                                    onMouseLeave={e => {
                                                                                                        if (!isChunkActive) {
                                                                                                            e.currentTarget.style.background = 'var(--accent-dim)';
                                                                                                            e.currentTarget.style.color = 'var(--accent)';
                                                                                                        }
                                                                                                    }}
                                                                                                >
                                                                                                    {item.srcNum}
                                                                                                </span>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="user-message-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
                                            <div className="user-message-text" style={{
                                                background: 'var(--user-bubble)', color: 'var(--text)',
                                                padding: '12px 18px', borderRadius: '18px', borderBottomRightRadius: 6,
                                                border: '1px solid var(--user-bubble-border)', fontWeight: 400,
                                                whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.6,
                                                maxWidth: '85%',
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                                            }}>
                                                {m.text}
                                            </div>
                                            {/* User message actions + timestamp row */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                                {m.timestamp && (
                                                    <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 500, paddingRight: 4 }}>
                                                        {formatTimestamp(m.timestamp)}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => copyMessage(m.text, i)}
                                                    title="Copy message"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: copiedIndex === i ? 'var(--green)' : 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '4px 6px',
                                                        transition: 'all 0.15s ease', gap: 6
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = copiedIndex === i ? 'var(--green)' : 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                >
                                                    {copiedIndex === i ? <Check size={15} /> : <Copy size={15} />}
                                                </button>
                                                <button
                                                    onClick={() => toast?.('Edit feature coming soon.', 'info')}
                                                    title="Edit message"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '4px 6px',
                                                        transition: 'all 0.15s ease', gap: 6
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                >
                                                    <Pencil size={15} />
                                                </button>
                                                <button
                                                    onClick={() => { if (window.confirm('Delete this Q&A pair?')) deleteMessagePair(i); }}
                                                    title="Delete this exchange"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '4px 6px',
                                                        transition: 'all 0.15s ease', gap: 6
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-dim)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}



                            {/* VERO Thinking Indicator (Before stream starts) */}
                            {searching && messages.length > 0 && messages[messages.length-1].role === 'user' && (
                                <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 28 }}>
                                    <div style={{
                                        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                                        background: 'var(--accent-dim)', border: '1.5px solid var(--accent)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        animation: 'pulse 1.5s ease-in-out infinite',
                                        boxShadow: '0 0 16px var(--accent-dim)',
                                    }}>
                                        <img src="/vero.svg" alt="V" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                    </div>
                                    <div style={{ paddingTop: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>VERO</span>
                                            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>awakening...</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Stop Generating Button */}
                            {(isStreaming || searching) && (
                                <div style={{ maxWidth: 840, margin: '0 auto 20px', display: 'flex', justifyContent: 'center' }}>
                                    <button
                                        onClick={stopGenerating}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '6px 16px', borderRadius: 100,
                                            background: 'var(--bg-2)', border: '1px solid var(--border)',
                                            color: 'var(--text-2)', cursor: 'pointer',
                                            fontSize: 12, fontWeight: 600,
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                                    >
                                        <Square size={12} fill="currentColor" /> Stop generating
                                    </button>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    )}
                </div>

                {/* Input Zone */}
                <div className="chat-input-zone" style={{ padding: '0px 32px 32px', background: 'var(--bg-0)', position: 'relative', zIndex: 10 }}>
                    <form onSubmit={send} style={{
                        maxWidth: 840, margin: '0 auto', position: 'relative',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 24, padding: '16px 20px',
                        display: 'flex', flexDirection: 'column', gap: 14,
                        boxShadow: '0 12px 32px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)',
                        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                        ...(docs.length === 0 ? { opacity: 0.5, pointerEvents: 'none', filter: 'grayscale(1)' } : {})
                    }}
                        onFocusCapture={e => {
                            e.currentTarget.style.borderColor = 'var(--accent-dim)';
                            e.currentTarget.style.boxShadow = '0 16px 40px rgba(0,0,0,0.08), 0 0 0 3px var(--accent-dim)';
                        }}
                        onBlurCapture={e => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)';
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <textarea
                                value={query}
                                onChange={e => {
                                    setQuery(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send(e);
                                    }
                                }}
                                disabled={docs.length === 0}
                                placeholder={docs.length === 0 ? "Import documents to start typing..." : (isStreaming || searching) ? "VERO is answering..." : "Ask VERO anything..."}
                                rows={1}
                                style={{
                                    flex: 1, border: 'none', background: 'transparent', color: 'var(--text)',
                                    padding: '4px 0', fontSize: 15, fontFamily: 'var(--font)',
                                    outline: 'none', fontWeight: 500, resize: 'none',
                                    minHeight: 28, maxHeight: 240, lineHeight: 1.6,
                                    overflowY: 'auto'
                                }}
                            />
                            <button type="submit" disabled={!query.trim() || searching || isStreaming || docs.length === 0}
                                title={isStreaming ? 'Wait for VERO to finish' : 'Send message'}
                                style={{
                                    width: 40, height: 40, borderRadius: '50%', border: 'none', flexShrink: 0,
                                    background: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--bg-2)' : 'var(--accent)',
                                    color: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--text-4)' : '#fff',
                                    cursor: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s ease',
                                    boxShadow: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'none' : '0 4px 12px rgba(0,0,0,0.15)'
                                }}
                                onMouseEnter={e => {
                                    if (query.trim() && !searching && !isStreaming && docs.length > 0) {
                                        e.currentTarget.style.opacity = '0.9';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (query.trim() && !searching && !isStreaming && docs.length > 0) {
                                        e.currentTarget.style.opacity = '1';
                                    }
                                }}
                            >
                                <ArrowUp size={20} strokeWidth={2.5} />
                            </button>
                        </div>

                        {/* Premium Compact Toolbar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                            
                            {/* Left Side: Agentic Toggles */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                
                                {/* Model Switcher Dropdown (Exhaustive & SOTA) */}
                                <div style={{ position: 'relative' }} ref={modelMenuRef}>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setModelMenuOpen(!modelMenuOpen);
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                            padding: '6px 14px', borderRadius: 14,
                                            background: 'var(--bg-1)', border: '1px solid var(--border)',
                                            color: 'var(--text)', fontSize: 13, fontWeight: 700,
                                            transition: 'all 0.15s ease', outline: 'none'
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-1)'; }}
                                    >
                                        <svg width="15" height="15" viewBox="0 0 210 210" fill="currentColor">
                                            <path d="M105.304012.00401184C47.7040118-.49598816.50401184 45.8040118.00401184 103.404012c-.5 57.6 45.79999996 104.8 103.40000016 105.3h36.2v-39.1h-34.3c-36.0000002.4-65.6000002-28.4-66.0000002-64.5-.4-36.1000002 28.4-65.6000002 64.5000002-66 36.1-.4 65.6 28.4 66 64.5-.4 36.1-28.4 65.6-64.5 66h-34.3v39.1h36.2c57.6-.5 104.8-45.8 105.3-103.4.5-57.6-45.8-104.9-103.4-105.3z" />
                                        </svg>
                                        Groq Llama 3
                                        <ChevronDown size={14} color="var(--text-4)" style={{ opacity: 0.9, transform: modelMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                                    </button>
                                    
                                    {/* Dropdown Menu (Popup) */}
                                    <div style={{
                                        position: 'absolute', bottom: 'calc(100% + 14px)', left: 0,
                                        width: 250, background: 'var(--bg-0)',
                                        border: '1px solid var(--border)', borderRadius: 16,
                                        padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2,
                                        boxShadow: '0 16px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
                                        opacity: modelMenuOpen ? 1 : 0, 
                                        pointerEvents: modelMenuOpen ? 'auto' : 'none', 
                                        transform: modelMenuOpen ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.98)',
                                        transformOrigin: 'bottom left',
                                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                        zIndex: 100
                                    }}>
                                        <div style={{ padding: '4px 12px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                            Available Models
                                        </div>
                                        
                                        <div style={{ padding: '4px 10px 6px', fontSize: 10, fontWeight: 800, color: 'var(--text-4)' }}>GROQ</div>
                                        {[
                                            { id: 'llama3-70b', name: 'Llama 3.3 70B', iconPath: 'M105.304012.00401184C47.7040118-.49598816.50401184 45.8040118.00401184 103.404012c-.5 57.6 45.79999996 104.8 103.40000016 105.3h36.2v-39.1h-34.3c-36.0000002.4-65.6000002-28.4-66.0000002-64.5-.4-36.1000002 28.4-65.6000002 64.5000002-66 36.1-.4 65.6 28.4 66 64.5-.4 36.1-28.4 65.6-64.5 66h-34.3v39.1h36.2c57.6-.5 104.8-45.8 105.3-103.4.5-57.6-45.8-104.9-103.4-105.3z', viewBox: '0 0 210 210', color: '#F55036', desc: 'Highest reasoning' },
                                            { id: 'llama3-8b', name: 'Llama 3.1 8B', iconPath: 'M105.304012.00401184C47.7040118-.49598816.50401184 45.8040118.00401184 103.404012c-.5 57.6 45.79999996 104.8 103.40000016 105.3h36.2v-39.1h-34.3c-36.0000002.4-65.6000002-28.4-66.0000002-64.5-.4-36.1000002 28.4-65.6000002 64.5000002-66 36.1-.4 65.6 28.4 66 64.5-.4 36.1-28.4 65.6-64.5 66h-34.3v39.1h36.2c57.6-.5 104.8-45.8 105.3-103.4.5-57.6-45.8-104.9-103.4-105.3z', viewBox: '0 0 210 210', color: '#F55036', desc: 'Instant responses' },
                                        ].map(m => (
                                            <button key={m.id} type="button" onClick={(e) => { e.preventDefault(); setModelMenuOpen(false); toast?.(`Switched to ${m.name}.`, 'success'); }} style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '6px 10px', borderRadius: 10, border: 'none',
                                                background: 'transparent', cursor: 'pointer',
                                                transition: 'all 0.15s ease', textAlign: 'left', outline: 'none'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <svg width="16" height="16" viewBox={m.viewBox} fill={m.color} style={{ flexShrink: 0 }}>
                                                    <path d={m.iconPath} />
                                                </svg>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                                                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-4)' }}>{m.desc}</span>
                                                </div>
                                            </button>
                                        ))}

                                        <div style={{ padding: '10px 10px 6px', fontSize: 10, fontWeight: 800, color: 'var(--text-4)' }}>GOOGLE</div>
                                        {[
                                            { id: 'gemini-2-flash', name: 'Gemini 2.0 Flash', iconPath: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81', viewBox: '0 0 24 24', color: '#1A73E8', desc: 'Speed & multimodality' }
                                        ].map(m => (
                                            <button key={m.id} type="button" onClick={(e) => { e.preventDefault(); setModelMenuOpen(false); toast?.(`Switched to ${m.name}.`, 'success'); }} style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '6px 10px', borderRadius: 10, border: 'none',
                                                background: 'transparent', cursor: 'pointer',
                                                transition: 'all 0.15s ease', textAlign: 'left', outline: 'none'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <svg width="16" height="16" viewBox={m.viewBox} fill={m.color} style={{ flexShrink: 0 }}>
                                                    <path d={m.iconPath} />
                                                </svg>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                                                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-4)' }}>{m.desc}</span>
                                                </div>
                                            </button>
                                        ))}

                                        <div style={{ padding: '10px 10px 6px', fontSize: 10, fontWeight: 800, color: 'var(--text-4)' }}>LOCAL</div>
                                        {[
                                            { id: 'ollama-llama3', name: 'Ollama Llama 3', iconPath: 'M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z', viewBox: '0 0 24 24', color: 'var(--text)', desc: '100% private offline logic' }
                                        ].map(m => (
                                            <button key={m.id} type="button" onClick={(e) => { e.preventDefault(); setModelMenuOpen(false); toast?.(`Local models disabled.`, 'error'); }} style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '6px 10px', borderRadius: 10, border: 'none',
                                                background: 'transparent', cursor: 'pointer',
                                                transition: 'all 0.15s ease', textAlign: 'left', outline: 'none'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <svg width="16" height="16" viewBox={m.viewBox} fill={m.color} style={{ flexShrink: 0 }}>
                                                    <path fillRule="evenodd" clipRule="evenodd" d={m.iconPath} />
                                                </svg>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                                                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-4)' }}>{m.desc}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Web Search Pivot */}
                                <button type="button"
                                    onClick={() => toast?.('Live Web Search capability is still in development.', 'info')}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                        padding: '6px 14px', borderRadius: 14, outline: 'none',
                                        background: 'var(--bg-1)', border: '1px solid var(--border)',
                                        color: 'var(--text)', fontSize: 13, fontWeight: 700,
                                        transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-1)'; }}
                                >
                                    <Globe size={15} color="var(--text-2)" />
                                    Search Web
                                </button>
                                
                                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

                                {/* Upgraded Model Knowledge Toggle */}
                                <button type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        const next = !modelKnowledge;
                                        setModelKnowledge(next);
                                        localStorage.setItem('vero-model-knowledge', String(next));
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', outline: 'none',
                                        padding: '6px 12px 6px 8px', borderRadius: 100,
                                        background: modelKnowledge ? 'var(--accent-dim)' : 'transparent',
                                        border: `1px solid ${modelKnowledge ? 'var(--accent-border)' : 'transparent'}`,
                                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                                    }}
                                    onMouseEnter={e => {
                                        if (!modelKnowledge) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-2)'; }
                                    }}
                                    onMouseLeave={e => {
                                        if (!modelKnowledge) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-4)'; }
                                    }}
                                >
                                    <div style={{
                                        width: 36, height: 20, borderRadius: 10,
                                        background: modelKnowledge ? 'var(--accent)' : 'var(--bg-3)',
                                        border: `1px solid ${modelKnowledge ? 'transparent' : 'var(--border)'}`,
                                        position: 'relative', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                    }}>
                                        <div style={{
                                            position: 'absolute', top: 1, left: modelKnowledge ? 17 : 1,
                                            width: 16, height: 16, borderRadius: '50%',
                                            background: modelKnowledge ? '#fff' : 'var(--text-3)',
                                            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                        }} />
                                    </div>
                                    <span style={{
                                        fontSize: 13, fontWeight: 600,
                                        color: modelKnowledge ? 'var(--accent)' : 'var(--text-4)',
                                        transition: 'color 0.3s ease'
                                    }}>
                                        Model Knowledge
                                    </span>
                                </button>
                            </div>

                            {/* Right Side Hint */}
                            <div className="hide-on-mobile" style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 4, fontSize: 9 }}>Enter</span> to Send</div>
                            </div>
                        </div>
                    </form>
                    <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-4)', marginTop: 8, fontWeight: 500, opacity: 0.7 }}>
                        VERO might produce hallucinated answers. Always verify critical information.
                    </p>
                </div>
            </div>

            {/* ═══════ RIGHT: Insight & Context ═══════ */}
            {isMobile && (
                <div
                    className={`sidebar-overlay ${rightPanelOpen ? 'active' : ''}`}
                    onClick={() => setRightPanelOpen(false)}
                    style={{ zIndex: 997 }}
                />
            )}
            <div
                className={isMobile ? `right-panel-mobile ${rightPanelOpen ? 'open' : ''}` : ''}
                style={{
                    width: rightPanelOpen ? (isMobile ? 320 : 300) : 0, flexShrink: 0, background: 'var(--bg-1)',
                    borderLeft: rightPanelOpen ? '1px solid var(--border)' : 'none',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    zIndex: isMobile ? 998 : 'auto'
                }}>
                {/* ── Compact Unified Ingest Zone ── */}
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>Add Sources</span>
                        {ingesting && <Loader2 size={14} className="spin" color="var(--accent)" />}
                        {isMobile && (
                            <button
                                onClick={() => setRightPanelOpen(false)}
                                style={{
                                    width: 24, height: 24, borderRadius: 6, background: 'transparent', border: 'none',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)',
                                    cursor: 'pointer', transition: 'all 0.15s ease'
                                }}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px', background: 'var(--bg-0)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                        <label
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            style={{
                                width: '100%', padding: '24px 16px', borderRadius: 12,
                                border: `2px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                                background: dragOver ? 'var(--bg-hover)' : 'transparent',
                                color: dragOver ? 'var(--text)' : 'var(--text-3)',
                                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)', position: 'relative', overflow: 'hidden'
                            }}
                            onMouseEnter={e => {
                                if (!dragOver) {
                                    e.currentTarget.style.borderColor = 'var(--text-4)';
                                    e.currentTarget.style.color = 'var(--text-2)';
                                    e.currentTarget.style.background = 'var(--bg-1)';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!dragOver) {
                                    e.currentTarget.style.borderColor = 'var(--border)';
                                    e.currentTarget.style.color = 'var(--text-3)';
                                    e.currentTarget.style.background = 'transparent';
                                }
                            }}
                        >
                            <div style={{
                                width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-2)', border: '1px solid var(--border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)',
                                transition: 'transform 0.2s ease', transform: dragOver ? 'scale(1.1)' : 'scale(1)', flexShrink: 0
                            }}>
                                <UploadCloud size={20} color={dragOver ? 'var(--accent)' : 'currentColor'} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{ingesting ? 'Processing Upload...' : 'Click or drag files to upload'}</span>
                                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-4)' }}>Supports PDF, DOCX, TXT, MD, CSV</span>
                            </div>
                            <input ref={fileRef} type="file" multiple onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }} accept=".pdf,.txt,.md,.docx,.csv" />
                        </label>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>OR IMPORT URL</span>
                            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
                        </div>

                        <form onSubmit={handleUrlIngest} style={{ display: 'flex', width: '100%', gap: 6, position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 10, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', color: 'var(--text-4)' }}>
                                <Globe size={14} />
                            </div>
                            <input
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder="Paste website or repo..."
                                style={{
                                    flex: 1, height: 36, padding: '0 10px 0 32px', background: 'var(--bg-2)',
                                    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
                                    fontSize: 12, outline: 'none', fontWeight: 500,
                                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease', minWidth: 0
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-dim)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--bg-hover)'; }}
                                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                            />
                            <button type="submit" disabled={!url.trim() || ingesting} style={{
                                width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                background: (!url.trim() || ingesting) ? 'var(--bg-3)' : 'var(--accent)',
                                color: (!url.trim() || ingesting) ? 'var(--text-4)' : 'var(--bg-0)',
                                border: 'none', borderRadius: 8, cursor: (!url.trim() || ingesting) ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                            }}
                            onMouseEnter={e => { if(url.trim() && !ingesting) e.currentTarget.style.transform = 'scale(1.05)'; }}
                            onMouseLeave={e => { if(url.trim() && !ingesting) e.currentTarget.style.transform = 'scale(1)'; }}
                            >
                                {ingesting ? <Loader2 size={14} className="spin" /> : <Plus size={16} />}
                            </button>
                        </form>
                        {ingesting && (
                            <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-3)', overflow: 'hidden', marginTop: 4 }}>
                                <div style={{ height: '100%', width: '40%', background: 'var(--accent)', borderRadius: 2, animation: 'shimmer 1.5s infinite' }} />
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Citation Chunk Drill-Down ── */}
                {activeCitationChunk && (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{
                                fontSize: 10, fontWeight: 800, width: 20, height: 20, borderRadius: 5,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--accent)', color: 'var(--bg-0)'
                            }}>
                                {activeCitationChunk.srcNum}
                            </span>
                            <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activeCitationChunk.doc_title}
                            </span>
                            <button onClick={() => setActiveCitationChunk(null)} style={{
                                width: 22, height: 22, borderRadius: 6, border: 'none',
                                background: 'transparent', color: 'var(--text-4)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-dim)'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div style={{
                            fontSize: 12, lineHeight: 1.6, color: 'var(--text-3)', fontWeight: 400,
                            maxHeight: 160, overflowY: 'auto', padding: '10px 12px',
                            background: 'var(--bg-0)', borderRadius: 8, border: '1px solid var(--border)',
                            fontStyle: 'italic'
                        }}>
                            "{activeCitationChunk.text?.substring(0, 600)}{activeCitationChunk.text?.length > 600 ? '...' : ''}"
                        </div>
                    </div>
                )}

                {/* ── Document List ── */}
                <div style={{ padding: '12px 16px 12px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Sources
                        </span>
                        <button onClick={fetchDocs} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 2 }}>
                            <RefreshCw size={12} className={docsLoading ? 'spin' : ''} />
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {docsLoading ? [1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 44, borderRadius: 8 }} />) :
                            docs.length === 0 ? (
                                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)' }}>
                                    <FileArchive size={32} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.3 }} />
                                    <p style={{ fontSize: 12, margin: 0 }}>No sources yet</p>
                                </div>
                            ) :
                                docs.map(d => {
                                    const status = getPreciseStatus(d);
                                    const StatusIcon = status.icon;
                                    const traces = docTraces[d.title] || [];
                                    const isActive = activeCitationDoc === d.title;
                                    const docType = getDocIcon(d.title);
                                    const DocIcon = docType.icon;

                                    return (
                                        <div id={`doc-${d.title}`} key={d.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '8px 10px', borderRadius: 8,
                                            background: isActive ? 'var(--accent-dim)' : 'transparent',
                                            border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                                            cursor: 'pointer', transition: 'all 0.15s ease'
                                        }}
                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-2)'; }}
                                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <DocIcon size={15} color={docType.color} style={{ flexShrink: 0 }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {d.title}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                                                    <StatusIcon size={10} color={status.color} className={status.label.includes('Step') ? 'spin' : ''} />
                                                    <span style={{ fontSize: 10, fontWeight: 600, color: status.color }}>{status.label}</span>
                                                    {traces.length > 0 && (
                                                        <span style={{
                                                            fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 4,
                                                            background: 'var(--accent-dim)', color: 'var(--accent)',
                                                            marginLeft: 2
                                                        }}>
                                                            {traces.length} cited
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                title="Remove source"
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Remove "${d.title}"?`)) {
                                                        try {
                                                            await api.deleteDocument(d.id);
                                                            fetchDocs();
                                                            toast?.('Source removed.', 'success');
                                                        } catch { toast?.('Failed to remove.', 'error'); }
                                                    }
                                                }}
                                                style={{
                                                    width: 24, height: 24, borderRadius: 6, border: 'none',
                                                    background: 'transparent', color: 'var(--text-4)',
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0, transition: 'color 0.15s ease'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; }}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                    </div>
                </div>
            </div>
        </div>
    );
}
