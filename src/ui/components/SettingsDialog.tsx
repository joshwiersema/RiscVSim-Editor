import { useEffect, useState } from 'react';
import { desktop, isDesktop, type DesktopSettings } from '../desktop';

interface SettingsDialogProps { readonly onClose: () => void }

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [detected, setDetected] = useState<string | null | 'checking'>('checking');

  useEffect(() => {
    desktop.getSettings().then(setSettings).catch(() => setSettings({ compilerPath: '', compilerFlags: '', recentFiles: [] }));
    desktop.detectCompiler().then(setDetected).catch(() => setDetected(null));
  }, []);

  const save = async (patch: Partial<DesktopSettings>) => {
    const next = await desktop.setSettings(patch);
    setSettings(next);
    setDetected('checking');
    setDetected(await desktop.detectCompiler());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head"><strong>Settings</strong><button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button></div>
        <div className="modal-body modal-body-single">
          <section>
            <h4>C compiler (RISC-V GCC)</h4>
            {!isDesktop && <p className="muted">C compilation is only available in the desktop app.</p>}
            {settings && (
              <>
                <label className="field-block">
                  <span>Compiler executable</span>
                  <div className="field-row">
                    <input className="input mono" value={settings.compilerPath} placeholder="auto-detect on PATH (riscv32-unknown-elf-gcc, riscv-none-elf-gcc, …)" onChange={(e) => setSettings({ ...settings, compilerPath: e.target.value })} onBlur={(e) => void save({ compilerPath: e.target.value })} />
                    <button className="btn btn-xs" onClick={async () => { const p = await desktop.pickFile('Choose the RISC-V gcc executable'); if (p) void save({ compilerPath: p }); }}>Browse…</button>
                  </div>
                </label>
                <label className="field-block">
                  <span>Extra flags</span>
                  <input className="input mono" value={settings.compilerFlags} onChange={(e) => setSettings({ ...settings, compilerFlags: e.target.value })} onBlur={(e) => void save({ compilerFlags: e.target.value })} />
                </label>
                <p className="muted">
                  Status: {detected === 'checking' ? 'checking…' : detected ? <span className="ok">found <code>{detected}</code></span> : <span className="bad">no compiler found</span>}.
                  RiscSim always adds <code>-march=rv32imc -mabi=ilp32 -nostdlib -nostartfiles</code>, its own linker script, start-up file and <code>riscsim.h</code>.
                </p>
                <p className="muted">
                  Get a toolchain: the xPack <code>riscv-none-elf-gcc</code> release (Windows, macOS, Linux) or your distribution's <code>gcc-riscv64-unknown-elf</code> package. Any riscv32/riscv64 GCC that can target rv32imc works.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
