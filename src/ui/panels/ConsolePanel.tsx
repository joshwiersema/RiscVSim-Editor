import { useEffect, useRef, useState } from 'react';
import { SYSCALL_TABLE } from '@/core/sim/ecall';
import { useStore } from '../state/store';

export function ConsolePanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const status = useStore((s) => s.status);
  const compileLog = useStore((s) => s.compileLog);
  const provideInput = useStore((s) => s.provideInput);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  void tick;
  const output = machine?.output ?? '';
  const error = machine?.core.error;
  const pending = machine?.core.pendingInput ?? null;

  useEffect(() => { if (pending) inputRef.current?.focus(); }, [pending]);

  const submit = () => { provideInput(input); setInput(''); };

  return (
    <div className="console">
      <pre className="console-output">{output || <span className="muted">Program output appears here (ecall 1, 4, 11, 34… or the character device).</span>}</pre>
      {pending && (
        <div className="console-input">
          <span className="console-prompt">{pending.kind === 'int' ? 'read_int' : pending.kind === 'char' ? 'read_char' : `read_string (max ${pending.maxLen})`} ›</span>
          <input ref={inputRef} className="input mono" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="type input and press Enter" />
          <button className="btn btn-xs btn-primary" onClick={submit}>Send</button>
        </div>
      )}
      {error && <div className="console-error">{error}</div>}
      {compileLog && (
        <details className="console-help" open={!machine}>
          <summary>Compiler output</summary>
          <pre className="console-log mono">{compileLog}</pre>
        </details>
      )}
      <div className="console-status">{status}</div>
      <details className="console-help">
        <summary>Syscalls (set a7, then ecall)</summary>
        <table className="table">
          <tbody>
            {SYSCALL_TABLE.map((s) => <tr key={s.code}><td className="mono">{s.code}</td><td>{s.name}</td><td className="muted">{s.args}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}
