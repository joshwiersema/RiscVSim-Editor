import { StreamLanguage, type StringStream } from '@codemirror/language';
import { INSTRUCTIONS } from '@/core/isa/instructions';
import { PSEUDO_NAMES } from '@/core/asm/pseudo';
import { ABI_NAMES, FP_ABI_NAMES } from '@/core/isa/registers';
import { CSR_NAMES } from '@/core/isa/csr';
import { RM_MNEMONICS } from '@/core/fp/format';

const MNEMONICS = new Set([...INSTRUCTIONS.map((i) => i.name), ...PSEUDO_NAMES]);
const REGS = new Set([
  ...ABI_NAMES, 'fp', ...Array.from({ length: 32 }, (_, i) => `x${i}`),
  ...FP_ABI_NAMES, ...Array.from({ length: 32 }, (_, i) => `f${i}`),
]);
/** CSR names and rounding-mode operands (rtz, dyn, ...). */
const OPERAND_WORDS = new Set([...CSR_NAMES.values(), ...RM_MNEMONICS.filter(Boolean)]);

/** Minimal stream-based RISC-V assembly highlighter. */
export const riscvLanguage = StreamLanguage.define<{ sol: boolean }>({
  startState: () => ({ sol: true }),
  token(stream: StringStream, state) {
    if (stream.sol()) state.sol = true;
    if (stream.eatSpace()) return null;
    if (stream.match(/^(#|\/\/).*/)) return 'comment';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)'/)) return 'string';
    if (stream.match(/^\.[A-Za-z_]\w*/)) { state.sol = false; return 'keyword'; }
    if (stream.match(/^[A-Za-z_.$][\w.$]*(?=\s*:)/)) { return 'labelName'; }
    if (stream.match(/^%(hi|lo|pcrel_hi|pcrel_lo)/)) return 'meta';
    if (stream.match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|-?\d+(\.\d+)?([eE][+-]?\d+)?)/)) return 'number';
    const word = stream.match(/^[A-Za-z_.$][\w.$]*/);
    if (word) {
      const w = (word as RegExpMatchArray)[0].toLowerCase();
      if (state.sol && MNEMONICS.has(w)) { state.sol = false; return 'keyword'; }
      if (REGS.has(w)) return 'variableName';
      if (OPERAND_WORDS.has(w)) return 'meta';
      state.sol = false;
      return 'atom';
    }
    if (stream.match(/^[,()+\-*/%&|^~<>]/)) return 'punctuation';
    stream.next();
    return null;
  },
});
