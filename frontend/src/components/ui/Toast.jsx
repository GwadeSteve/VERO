import { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

let _id = 0;

export function ToastProvider({ children }) {
    const [items, setItems] = useState([]);

    const remove = useCallback((id) => {
        setItems(p => p.map(t => t.id === id ? { ...t, exiting: true } : t));
        setTimeout(() => {
            setItems(p => p.filter(t => t.id !== id));
        }, 300); // 300ms matches CSS transition duration
    }, []);

    const toast = useCallback((msg, type = 'info', dur = 3500) => {
        const id = ++_id;
        setItems(p => [...p, { id, msg, type, exiting: false }]);
        setTimeout(() => remove(id), dur);
    }, [remove]);

    return (
        <Ctx.Provider value={toast}>
            {children}
            <div className="toast-wrap">
                {items.map(t => {
                    let Icon = Info;
                    let color = 'var(--accent)';
                    if (t.type === 'success') { Icon = CheckCircle2; color = 'var(--green)'; }
                    if (t.type === 'error') { Icon = AlertCircle; color = 'var(--red)'; }

                    return (
                        <div key={t.id} className={`toast-item ${t.exiting ? 'exiting' : ''}`}>
                            <Icon size={16} color={color} style={{ marginRight: 4 }} />
                            <span style={{ flex: 1, fontWeight: 500 }}>{t.msg}</span>
                            <button onClick={() => remove(t.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', padding: 4 }}>
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </Ctx.Provider>
    );
}
