import { comp, wire, type Layout } from './layout';

/**
 * Five-stage pipelined RV32IM datapath with forwarding and hazard detection.
 * 1500 x 660 viewBox. Pipeline registers are the tall bars between stages.
 * Bottom lanes (top to bottom): EX/MEM forward (520), MEM/WB forward (527),
 * PCSrc (605), branch target (612), rd (622), RegWrite (632), WB data (642).
 */
export const PIPELINE_LAYOUT: Layout = {
  width: 1500,
  height: 660,
  bands: [
    { stage: 'IF', x: 0, w: 321 },
    { stage: 'ID', x: 321, w: 320 },
    { stage: 'EX', x: 641, w: 340 },
    { stage: 'MEM', x: 981, w: 240 },
    { stage: 'WB', x: 1221, w: 279 },
  ],
  components: [
    // IF
    comp('muxPc', 'mux', 20, 280, 28, 50, 'M', 'IF', { inputs: ['+4', 'tgt'] }),
    comp('pc', 'box', 80, 270, 44, 70, 'PC', 'IF'),
    comp('pc4add', 'adder', 170, 150, 50, 60, 'Add', 'IF'),
    comp('muxPcInc', 'mux', 108, 176, 18, 32, 'M', 'IF', { inputs: ['2', '4'] }),
    comp('imem', 'box', 180, 270, 84, 110, 'Instr', 'IF', { sub: 'memory' }),
    comp('decomp', 'logic', 272, 305, 28, 60, 'C', 'IF', { sub: 'exp' }),
    comp('ifid', 'reg', 310, 60, 22, 440, 'IF/ID', 'ID'),
    // ID
    comp('hazard', 'logic', 490, 20, 110, 60, 'Hazard', 'ID', { sub: 'detection' }),
    comp('control', 'box', 370, 110, 90, 60, 'Control', 'ID'),
    comp('regfile', 'box', 400, 260, 140, 160, 'Registers', 'ID'),
    comp('immgen', 'box', 400, 460, 110, 60, 'Imm', 'ID', { sub: 'gen' }),
    comp('idex', 'reg', 630, 60, 22, 440, 'ID/EX', 'EX'),
    // EX
    comp('branchAdd', 'adder', 760, 100, 50, 60, 'Add', 'EX'),
    comp('muxFwdA', 'mux', 684, 250, 28, 70, 'M', 'EX', { inputs: ['reg', 'ex/m', 'm/wb'] }),
    comp('muxFwdB', 'mux', 684, 350, 28, 70, 'M', 'EX', { inputs: ['reg', 'ex/m', 'm/wb'] }),
    comp('muxAluA', 'mux', 760, 250, 28, 60, 'M', 'EX', { inputs: ['pc', 'rs1'] }),
    comp('muxAluB', 'mux', 760, 350, 28, 70, 'M', 'EX', { inputs: ['rs2', 'imm'] }),
    comp('alu', 'alu', 820, 260, 70, 130, 'ALU', 'EX'),
    comp('branchUnit', 'logic', 820, 450, 70, 60, 'Branch', 'EX', { sub: 'compare' }),
    comp('pcSrcLogic', 'logic', 905, 450, 55, 60, 'PCSrc', 'EX'),
    comp('forward', 'logic', 760, 545, 120, 50, 'Forwarding', 'EX', { sub: 'unit' }),
    comp('exmem', 'reg', 970, 60, 22, 440, 'EX/MEM', 'MEM'),
    // MEM
    comp('dmem', 'box', 1040, 270, 110, 120, 'Data', 'MEM', { sub: 'memory' }),
    comp('memwb', 'reg', 1210, 60, 22, 440, 'MEM/WB', 'WB'),
    // WB
    comp('muxWb', 'mux', 1280, 280, 28, 90, 'M', 'WB', { inputs: ['alu', 'mem', '+4'] }),
  ],
  wires: [
    // ---------------------------------------------------------------- IF
    wire('w.nextPc', 'data', 'IF', [[[48, 305], [80, 305]]]),
    wire('w.pc', 'data', 'IF', [
      [[124, 305], [180, 305]],
      [[150, 305], [150, 168], [170, 168]],
      [[150, 168], [150, 120], [310, 120]],
    ], { valueAt: [157, 295] }),
    wire('w.const4', 'data', 'IF', [[[126, 192], [170, 192]]], { explain: 'muxPcInc' }),
    wire('c.pcInc', 'control', 'IF', [[[286, 305], [286, 240], [117, 240], [117, 208]]], { label: { at: [214, 236], text: 'PCInc (2/4)' } }),
    wire('w.pc4', 'data', 'IF', [
      [[220, 180], [240, 180], [240, 30], [8, 30], [8, 292], [20, 292]],
      [[240, 180], [310, 180]],
    ], { valueAt: [240, 100] }),
    wire('w.instr', 'data', 'IF', [[[264, 335], [272, 335]], [[300, 335], [310, 335]]], { valueAt: [262, 325] }),
    // ---------------------------------------------------------------- ID
    wire('w.instr.id', 'data', 'ID', [
      [[332, 335], [350, 335]],
      [[350, 140], [350, 490]],
      [[350, 140], [370, 140]],
      [[350, 490], [400, 490]],
    ], { explain: 'w.instr' }),
    wire('w.rs1', 'data', 'ID', [[[350, 290], [400, 290]]], { label: { at: [375, 284], text: 'rs1' } }),
    wire('w.rs2', 'data', 'ID', [[[350, 320], [400, 320]]], { label: { at: [375, 314], text: 'rs2' } }),
    wire('w.rd.id', 'data', 'ID', [[[350, 444], [630, 444]]], { explain: 'w.rd', label: { at: [560, 439], text: 'rd' } }),
    wire('w.pc.id', 'data', 'ID', [[[332, 120], [345, 120], [345, 100], [630, 100]]], { explain: 'w.pc' }),
    wire('w.pc4.id', 'data', 'ID', [[[332, 180], [630, 180]]], { explain: 'w.pc4' }),
    wire('w.rs1val', 'data', 'ID', [[[540, 300], [630, 300]]], { valueAt: [550, 292] }),
    wire('w.rs2val', 'data', 'ID', [[[540, 360], [630, 360]]], { valueAt: [550, 352] }),
    wire('w.imm', 'data', 'ID', [[[510, 490], [630, 490]]], { valueAt: [520, 482] }),
    wire('c.ctrl.id', 'control', 'ID', [[[460, 150], [630, 150]]], { explain: 'control', label: { at: [545, 145], text: 'EX / MEM / WB control' } }),
    wire('c.stall', 'control', 'ID', [
      [[490, 45], [102, 45], [102, 270]],
      [[316, 45], [316, 60]],
      [[600, 45], [636, 45], [636, 60]],
    ], { label: { at: [200, 40], text: 'PCWrite · IF/IDWrite · bubble' } }),
    // ---------------------------------------------------------------- EX
    wire('w.pc.ex', 'data', 'EX', [
      [[652, 100], [720, 100], [720, 118], [760, 118]],
      [[720, 118], [720, 262], [760, 262]],
    ], { explain: 'w.pc' }),
    wire('w.pc4.ex', 'data', 'EX', [[[652, 180], [970, 180]]], { explain: 'w.pc4' }),
    wire('w.rs1val.ex', 'data', 'EX', [[[652, 300], [658, 300], [658, 260], [684, 260]]], { explain: 'w.rs1val' }),
    wire('w.rs2val.ex', 'data', 'EX', [[[652, 360], [684, 360]]], { explain: 'w.rs2val' }),
    wire('w.fwdA', 'data', 'EX', [
      [[712, 285], [760, 285]],
      [[736, 285], [736, 465], [820, 465]],
    ], { valueAt: [714, 277] }),
    wire('w.fwdB', 'data', 'EX', [
      [[712, 385], [760, 385]],
      [[744, 385], [744, 495], [820, 495]],
      [[744, 436], [970, 436]],
    ], { valueAt: [714, 377] }),
    wire('w.imm.ex', 'data', 'EX', [
      [[652, 490], [752, 490], [752, 410], [760, 410]],
      [[752, 410], [752, 142], [760, 142]],
    ], { explain: 'w.imm' }),
    wire('w.aluA', 'data', 'EX', [[[788, 280], [820, 280]]]),
    wire('w.aluB', 'data', 'EX', [[[788, 385], [820, 385]]]),
    wire('w.aluResult', 'data', 'EX', [
      [[890, 325], [970, 325]],
      [[910, 325], [910, 250], [970, 250]],
    ], { valueAt: [896, 315] }),
    wire('w.branchTarget', 'data', 'EX', [[[810, 130], [935, 130], [935, 450]]], { valueAt: [815, 120] }),
    wire('w.branchCond', 'control', 'EX', [[[890, 480], [905, 480]]]),
    wire('c.pcSrc', 'control', 'EX', [[[960, 480], [965, 480], [965, 605], [34, 605], [34, 330]]], { label: { at: [500, 601], text: 'PCSrc' } }),
    wire('w.target', 'data', 'EX', [[[932, 510], [932, 612], [14, 612], [14, 318], [20, 318]]], { explain: 'w.nextPc', label: { at: [420, 608], text: 'branch / jump target' } }),
    wire('c.flush', 'control', 'EX', [
      [[945, 450], [945, 8], [326, 8], [326, 60]],
      [[646, 8], [646, 60]],
    ], { label: { at: [800, 4], text: 'IF.Flush · ID.Flush' } }),
    wire('w.rd.ex', 'data', 'EX', [[[652, 444], [970, 444]]], { explain: 'w.rd' }),
    wire('c.ctrl.ex', 'control', 'EX', [[[652, 150], [970, 150]]], { explain: 'control' }),
    wire('c.aluSrcA', 'control', 'EX', [[[774, 150], [774, 250]]], { label: { at: [778, 240], text: 'ALUSrcA', anchor: 'start' } }),
    wire('c.aluSrcB', 'control', 'EX', [[[774, 430], [774, 420]]], { label: { at: [778, 432], text: 'ALUSrc', anchor: 'start' } }),
    wire('c.aluOp', 'control', 'EX', [[[855, 150], [855, 275]]], { label: { at: [859, 240], text: 'ALUOp', anchor: 'start' } }),
    wire('c.fwdA', 'control', 'EX', [[[770, 545], [770, 538], [728, 538], [728, 235], [698, 235], [698, 250]]], { explain: 'muxFwdA', label: { at: [704, 230], text: 'ForwardA', anchor: 'start' } }),
    wire('c.fwdB', 'control', 'EX', [[[728, 438], [698, 438], [698, 420]]], { explain: 'muxFwdB', label: { at: [704, 434], text: 'ForwardB', anchor: 'start' } }),
    // ---------------------------------------------------------------- MEM
    wire('w.memAddr', 'data', 'MEM', [[[992, 325], [1010, 325], [1010, 300], [1040, 300]]]),
    wire('w.memWriteData', 'data', 'MEM', [[[992, 436], [1020, 436], [1020, 350], [1040, 350]]]),
    wire('w.memReadData', 'data', 'MEM', [[[1150, 325], [1210, 325]]], { valueAt: [1160, 315] }),
    wire('w.aluResult.mem', 'data', 'MEM', [[[992, 250], [1210, 250]]], { explain: 'w.aluResult' }),
    wire('w.pc4.mem', 'data', 'MEM', [[[992, 180], [1210, 180]]], { explain: 'w.pc4' }),
    wire('w.rd.mem', 'data', 'MEM', [[[992, 444], [1210, 444]]], { explain: 'w.rd' }),
    wire('c.ctrl.mem', 'control', 'MEM', [[[992, 150], [1210, 150]]], { explain: 'control' }),
    wire('c.memRead', 'control', 'MEM', [[[1070, 150], [1070, 270]]], { label: { at: [1074, 230], text: 'MemRead', anchor: 'start' } }),
    wire('c.memWrite', 'control', 'MEM', [[[1120, 150], [1120, 270]]], { label: { at: [1124, 230], text: 'MemWrite', anchor: 'start' } }),
    wire('w.fwdExMem', 'data', 'MEM', [
      [[1010, 300], [1010, 520], [664, 520], [664, 285], [684, 285]],
      [[664, 385], [684, 385]],
    ], { explain: 'forward', label: { at: [1100, 516], text: 'EX/MEM result → forwarding' } }),
    // ---------------------------------------------------------------- WB
    wire('w.aluResult.wb', 'data', 'WB', [[[1232, 250], [1260, 250], [1260, 295], [1280, 295]]], { explain: 'w.aluResult' }),
    wire('w.memReadData.wb', 'data', 'WB', [[[1232, 325], [1280, 325]]], { explain: 'w.memReadData' }),
    wire('w.pc4.wb', 'data', 'WB', [[[1232, 180], [1270, 180], [1270, 355], [1280, 355]]], { explain: 'w.pc4' }),
    wire('c.wbSrc', 'control', 'WB', [[[1232, 150], [1294, 150], [1294, 280]]], { label: { at: [1298, 240], text: 'MemToReg', anchor: 'start' } }),
    wire('c.regWrite.wb', 'control', 'WB', [[[1250, 150], [1250, 130], [1450, 130], [1450, 632], [385, 632], [385, 240], [440, 240], [440, 260]]], { explain: 'c.regWrite', label: { at: [1350, 126], text: 'RegWrite → register file' } }),
    wire('w.rd.wb', 'data', 'WB', [[[1232, 444], [1400, 444], [1400, 622], [378, 622], [378, 350], [400, 350]]], { explain: 'w.rd', label: { at: [1316, 439], text: 'rd → write register' } }),
    wire('w.wbData', 'data', 'WB', [
      [[1308, 325], [1330, 325], [1330, 642], [370, 642], [370, 395], [400, 395]],
      [[1330, 527], [670, 527], [670, 310], [684, 310]],
      [[670, 410], [684, 410]],
    ], { valueAt: [1312, 315], label: { at: [1100, 538], text: 'MEM/WB result → forwarding & write-back' } }),
  ],
};
