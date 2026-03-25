import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
    FileText, BookOpen, Sparkles, ChevronDown,
    Copy, Check, Pencil, Trash2
} from 'lucide-react';

/**
 * Map of Unicode math symbols → LaTeX equivalents.
 */
const UNICODE_TO_LATEX = {
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
    'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
    'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\varphi',
    'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
    'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
    'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
    '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∂': '\\partial',
    '∇': '\\nabla', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
    '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
    '∪': '\\cup', '∩': '\\cap', '∀': '\\forall', '∃': '\\exists',
    '∞': '\\infty', '≈': '\\approx', '≠': '\\neq', '≤': '\\leq',
    '≥': '\\geq', '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow',
    '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
    '×': '\\times', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
    '√': '\\sqrt', '∝': '\\propto', '⊗': '\\otimes', '⊕': '\\oplus',
    'ℝ': '\\mathbb{R}', 'ℤ': '\\mathbb{Z}', 'ℕ': '\\mathbb{N}',
    'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}',
};

const mathSymbolPattern = /[α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ∗]/;

function postprocessMathForRendering(text) {
    if (!text || !mathSymbolPattern.test(text)) return text;

    const lines = text.split('\n');
    let inCodeBlock = false;

    return lines.map(line => {
        if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; return line; }
        if (inCodeBlock || line.trim().startsWith('$$')) return line;
        if (/\$[^$]+\$/.test(line) && !mathSymbolPattern.test(line.replace(/\$[^$]+\$/g, ''))) return line;

        return line.replace(
            /[({]?[a-zA-Z0-9_^∗*{}()\[\], =+\-/.]*[α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ∗][a-zA-Z0-9_^∗*{}()\[\], =+\-/.α-ωΑ-Ωϕ∑∏∫∂∇∈∉⊂⊃⊆⊇∪∩∀∃∞≈≠≤≥⇒⇐⇔×±∓√∝⊗⊕ℝℤℕℂℙ]*[)}]?/g,
            (match) => {
                const trimmed = match.trim();
                if (!trimmed) return match;
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
    }).join('\n');
}

function preprocessTextForMarkdown(text) {
    if (!text) return '';
    let result = postprocessMathForRendering(text);
    result = result.replace(/\[Source\s+(\d+)\]/gi, (_, num) => `[${num}](cite:${num})`);
    result = result.replace(/\[(\d+)\](?!\()/g, (_, num) => `[${num}](cite:${num})`);
    return result;
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date}, ${time}`;
}

/**
 * ChatMessage — Memoized component for rendering a single chat message.
 *
 * PERFORMANCE: This component is wrapped in React.memo with a custom comparator
 * so that it only re-renders when its own props change — NOT when unrelated state
 * (like the textarea input or other messages) changes.
 *
 * For a chat with 600+ messages, this reduces re-renders from O(N) to O(1) on
 * every keystroke and state change.
 */
const ChatMessage = memo(function ChatMessage({
    message: m,
    index: i,
    copiedIndex,
    activeCitationDoc,
    activeCitationChunk,
    isAccordionOpen,
    onCopy,
    onDelete,
    onToggleCitations,
    onCitationClick,
    onChunkClick,
    rightPanelOpen,
    onOpenRightPanel,
    toast,
}) {
    // Memoize the expensive markdown preprocessing
    const processedText = useMemo(() => preprocessTextForMarkdown(m.text), [m.text]);

    if (m.role === 'user') {
        return (
            <div className="user-message-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
                <div className="user-message-text" style={{
                    background: 'var(--user-bubble)', color: 'var(--text)',
                    padding: '10px 16px', borderRadius: '16px', borderBottomRightRadius: 4,
                    border: '1px solid var(--user-bubble-border)', fontWeight: 400,
                    whiteSpace: 'pre-wrap'
                }}>
                    {m.text}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    {m.timestamp && (
                        <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 500, paddingRight: 4 }}>
                            {formatTimestamp(m.timestamp)}
                        </span>
                    )}
                    <button
                        onClick={() => onCopy(m.text, i)}
                        title="Copy message"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 6px', borderRadius: 5, border: 'none',
                            background: 'transparent', color: copiedIndex === i ? 'var(--green)' : 'var(--text-4)',
                            cursor: 'pointer', fontSize: 13, fontWeight: 500,
                            transition: 'all 0.15s ease'
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
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 6px', borderRadius: 5, border: 'none',
                            background: 'transparent', color: 'var(--text-4)',
                            cursor: 'pointer', fontSize: 13, fontWeight: 500,
                            transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                        <Pencil size={15} />
                    </button>
                    <button
                        onClick={() => { if (window.confirm('Delete this Q&A pair?')) onDelete(i); }}
                        title="Delete this exchange"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 6px', borderRadius: 5, border: 'none',
                            background: 'transparent', color: 'var(--text-4)',
                            cursor: 'pointer', fontSize: 13, fontWeight: 500,
                            transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-dim)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                        <Trash2 size={15} />
                    </button>
                </div>
            </div>
        );
    }

    // Assistant / Error message
    const grouped = useMemo(() => {
        if (!m.traces?.length) return null;
        const g = {};
        m.traces.forEach((t, idx) => {
            if (!g[t.doc_title]) g[t.doc_title] = { title: t.doc_title, items: [] };
            g[t.doc_title].items.push({ ...t, srcNum: idx + 1 });
        });
        return Object.values(g);
    }, [m.traces]);

    return (
        <div className="ai-message-container" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            {/* AI Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    background: 'var(--accent-dim)',
                    border: `1.5px solid ${m.isStreaming ? 'var(--accent)' : 'var(--accent-border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: m.isStreaming ? '0 0 12px var(--accent-dim)' : 'var(--shadow-sm)',
                    transition: 'all 0.3s ease',
                    animation: m.isStreaming ? 'pulse 2s ease-in-out infinite' : 'none',
                }}>
                    <img src="/vero.svg" alt="V" style={{ width: 16, height: 16, objectFit: 'contain' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>VERO</span>
                    {m.timestamp && <span style={{ fontSize: 13, color: 'var(--text-4)', fontWeight: 500 }}>{formatTimestamp(m.timestamp)}</span>}
                    {m.stopped && <span style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>· Stopped</span>}
                    {m.usedModelKnowledge && (
                        <div className="ai-knowledge-badge" title="This response leveraged the AI's built-in model knowledge">
                            <Sparkles size={13} className="ai-icon-sparkle" />
                            <span>Model Knowledge</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="ai-message-content" style={{ paddingLeft: 44, width: '100%' }}>
                <div className={`vero-md ${m.isStreaming ? "streaming-cursor" : ""}`} style={{
                    color: m.role === 'error' ? 'var(--red)' : 'var(--text)'
                }}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        urlTransform={(value) => {
                            if (value.startsWith('cite:')) return value;
                            return value.replace(/^javascript:/i, '');
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
                                                onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
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
                                            onClick={() => onChunkClick(num, trace)}
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
                        {processedText}
                    </ReactMarkdown>
                </div>

                {/* Message Actions */}
                {!m.isStreaming && m.role === 'assistant' && (
                    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
                        <button
                            onClick={() => onCopy(m.text, i)}
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

                {/* Grouped Source Documents Accordion */}
                {!m.isStreaming && grouped && grouped.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                        <div
                            onClick={() => onToggleCitations(i)}
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
                                    {grouped.map((doc, di) => {
                                        const isActive = activeCitationDoc === doc.title;
                                        return (
                                            <div key={di} onClick={() => onCitationClick(doc.title)} style={{
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
                                                        const isItemActive = activeCitationChunk?.srcNum === item.srcNum;
                                                        return (
                                                            <span key={item.srcNum}
                                                                onClick={(e) => { e.stopPropagation(); onChunkClick(item.srcNum, item); }}
                                                                style={{
                                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                    padding: '0 7px', margin: '0 2px', borderRadius: 5, minWidth: 20, height: 20,
                                                                    background: isItemActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                    border: '1px solid var(--accent-border)',
                                                                    color: isItemActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                    fontSize: 11, fontWeight: 800,
                                                                    cursor: 'pointer', lineHeight: '20px',
                                                                    transition: 'all 0.15s ease'
                                                                }}
                                                                onMouseEnter={e => { if (!isItemActive) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--bg-0)'; } }}
                                                                onMouseLeave={e => { if (!isItemActive) { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; } }}
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
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparator: only re-render if these specific props changed
    return (
        prevProps.message === nextProps.message &&
        prevProps.copiedIndex === nextProps.copiedIndex &&
        prevProps.activeCitationDoc === nextProps.activeCitationDoc &&
        prevProps.activeCitationChunk === nextProps.activeCitationChunk &&
        prevProps.isAccordionOpen === nextProps.isAccordionOpen &&
        prevProps.index === nextProps.index
    );
});

export default ChatMessage;
