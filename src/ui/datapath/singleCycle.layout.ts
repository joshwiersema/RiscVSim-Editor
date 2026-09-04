import { comp, wire, type Layout } from './layout';

/**
 * Single-cycle RV32IM datapath. Coordinates are in a 1180 x 640 viewBox.
 * Left-to-right flow: PC -> I-mem -> decode/regfile/imm -> muxes -> ALU ->
 * D-mem -> WB mux, with feedback lanes along the top (PC+4) and bottom
 * (branch target, jalr target, write-back data, PCSrc).
 */
export const SINGLE_CYCLE_LAYOUT: Layout = {
  width: 1180,
  height: 640,
  bands: [
    { stage: 'IF', x: 0, w: 330 },
    { stage: 'ID', x: 330, w: 350 },
    { stage: 'EX', x: 680, w: 230 },
    { stage: 'MEM', x: 910, w: 170 },
    { stage: 'WB', x: 1080, w: 100 },
  ],
  components: [
    comp('muxPc', 'mux', 20, 280, 28, 70, 'M', 'WB', { inputs: ['+4', 'br', 'alu'] }),
    comp('pc', 'box', 80, 280, 44, 70, 'PC', 'IF'),
    comp('pc4add', 'adder', 170, 150, 50, 60, 'Add', 'IF'),
    comp('muxPcInc', 'mux', 108, 176, 18, 32, 'M', 'IF', { inputs: ['2', '4'] }),
    comp('imem', 'box', 190, 280, 90, 110, 'Instr', 'IF', { sub: 'memory' }),
    comp('decomp', 'logic', 288, 305, 30, 60, 'C', 'IF', { sub: 'exp' }),
    comp('control', 'box', 460, 50, 110, 130, 'Control', 'ID'),
    comp('regfile', 'box', 460, 260, 140, 160, 'Registers', 'ID'),
    comp('immgen', 'box', 460, 460, 110, 60, 'Imm', 'ID', { sub: 'gen' }),
    comp('muxAluA', 'mux', 690, 250, 28, 70, 'M', 'EX', { inputs: ['pc', 'rs1'] }),
    comp('muxAluB', 'mux', 690, 340, 28, 70, 'M', 'EX', { inputs: ['rs2', 'imm'] }),
    comp('branchAdd', 'adder', 690, 140, 50, 60, 'Add', 'EX'),
    comp('alu', 'alu', 770, 260, 70, 130, 'ALU', 'EX'),
    comp('branchUnit', 'logic', 770, 440, 70, 60, 'Branch', 'EX', { sub: 'compare' }),
    comp('pcSrcLogic', 'logic', 860, 440, 60, 60, 'PCSrc', 'EX'),
    comp('dmem', 'box', 920, 270, 110, 120, 'Data', 'MEM', { sub: 'memory' }),
    comp('muxWb', 'mux', 1090, 280, 28, 90, 'M', 'WB', { inputs: ['alu', 'mem', '+4'] }),
  ],
  wires: [
    // ---- IF
    wire('w.nextPc', 'data', 'WB', [[[48, 315], [80, 315]]]),
    wire('w.pc', 'data', 'IF', [
      [[124, 315], [190, 315]],
      [[150, 315], [150, 168], [170, 168]],
      [[150, 216], [655, 216], [655, 158], [690, 158]],
      [[655, 216], [655, 265], [690, 265]],
    ], { valueAt: [157, 305] }),
    wire('w.const4', 'data', 'IF', [[[126, 192], [170, 192]]], { explain: 'muxPcInc' }),
    wire('c.pcInc', 'control', 'IF', [[[303, 305], [303, 240], [117, 240], [117, 208]]], { label: { at: [222, 236], text: 'PCInc (2/4)' } }),
    wire('w.pc4', 'data', 'IF', [
      [[220, 180], [240, 180], [240, 30], [8, 30], [8, 292], [20, 292]],
      [[240, 30], [1070, 30], [1070, 355], [1090, 355]],
    ], { valueAt: [240, 100] }),
    wire('w.instr', 'data', 'IF', [
      [[280, 335], [288, 335]],
      [[318, 335], [340, 335]],
      [[340, 115], [340, 490]],
      [[340, 115], [460, 115]],
      [[340, 490], [460, 490]],
    ], { valueAt: [320, 325], label: { at: [400, 108], text: 'opcode' } }),
    wire('w.rs1', 'data', 'ID', [[[340, 290], [460, 290]]], { label: { at: [400, 284], text: 'rs1' } }),
    wire('w.rs2', 'data', 'ID', [[[340, 320], [460, 320]]], { label: { at: [400, 314], text: 'rs2' } }),
    wire('w.rd', 'data', 'ID', [[[340, 350], [460, 350]]], { label: { at: [400, 344], text: 'rd' } }),
    // ---- ID
    wire('w.rs1val', 'data', 'ID', [
      [[600, 300], [690, 300]],
      [[640, 300], [640, 455], [770, 455]],
    ], { valueAt: [612, 292] }),
    wire('w.rs2val', 'data', 'ID', [
      [[600, 360], [690, 360]],
      [[660, 360], [660, 485], [770, 485]],
    ], { valueAt: [612, 352] }),
    wire('w.imm', 'data', 'ID', [
      [[570, 490], [675, 490], [675, 182], [690, 182]],
      [[675, 395], [690, 395]],
    ], { valueAt: [590, 482] }),
    // ---- EX
    wire('w.aluA', 'data', 'EX', [[[718, 285], [770, 285]]]),
    wire('w.aluB', 'data', 'EX', [[[718, 375], [770, 375]]]),
    wire('w.aluResult', 'data', 'EX', [
      [[840, 325], [850, 325]],
      [[850, 325], [850, 250], [1060, 250], [1060, 295], [1090, 295]],
      [[850, 325], [850, 560], [10, 560], [10, 338], [20, 338]],
    ], { valueAt: [856, 240] }),
    wire('w.memAddr', 'data', 'MEM', [[[850, 300], [920, 300]]]),
    wire('w.branchTarget', 'data', 'EX', [[[740, 170], [755, 170], [755, 540], [14, 540], [14, 315], [20, 315]]], { valueAt: [745, 160] }),
    wire('w.branchCond', 'control', 'EX', [[[840, 470], [860, 470]]]),
    wire('c.pcSrc', 'control', 'EX', [[[920, 470], [940, 470], [940, 578], [34, 578], [34, 350]]], { label: { at: [480, 574], text: 'PCSrc' } }),
    // ---- MEM
    wire('w.memWriteData', 'data', 'MEM', [[[660, 420], [900, 420], [900, 350], [920, 350]]]),
    wire('w.memReadData', 'data', 'MEM', [[[1030, 325], [1090, 325]]], { valueAt: [1040, 315] }),
    // ---- WB
    wire('w.wbData', 'data', 'WB', [[[1118, 325], [1140, 325], [1140, 595], [420, 595], [420, 395], [460, 395]]], { valueAt: [1122, 315], label: { at: [780, 591], text: 'write-back data' } }),
    // ---- control signals
    wire('c.regWrite', 'control', 'ID', [[[500, 180], [500, 260]]], { label: { at: [504, 230], text: 'RegWrite', anchor: 'start' } }),
    wire('c.branch', 'control', 'ID', [[[570, 70], [875, 70], [875, 440]]], { label: { at: [578, 66], text: 'Branch', anchor: 'start' } }),
    wire('c.jump', 'control', 'ID', [[[570, 90], [905, 90], [905, 440]]], { label: { at: [578, 86], text: 'Jump', anchor: 'start' } }),
    wire('c.memRead', 'control', 'ID', [[[570, 110], [950, 110], [950, 270]]], { label: { at: [578, 106], text: 'MemRead', anchor: 'start' } }),
    wire('c.memWrite', 'control', 'ID', [[[570, 130], [1000, 130], [1000, 270]]], { label: { at: [578, 126], text: 'MemWrite', anchor: 'start' } }),
    wire('c.wbSrc', 'control', 'ID', [[[570, 150], [1104, 150], [1104, 280]]], { label: { at: [578, 146], text: 'MemToReg', anchor: 'start' } }),
    wire('c.aluOp', 'control', 'ID', [[[570, 170], [805, 170], [805, 275]]], { label: { at: [578, 166], text: 'ALUOp', anchor: 'start' } }),
    wire('c.aluSrcA', 'control', 'ID', [[[560, 180], [560, 240], [704, 240], [704, 250]]], { label: { at: [600, 236], text: 'ALUSrcA', anchor: 'start' } }),
    wire('c.aluSrcB', 'control', 'ID', [[[550, 180], [550, 228], [725, 228], [725, 425], [704, 425], [704, 410]]], { label: { at: [600, 224], text: 'ALUSrc', anchor: 'start' } }),
  ],
};
