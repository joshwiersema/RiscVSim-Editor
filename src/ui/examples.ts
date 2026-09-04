export interface Example {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly source: string;
}

export const C_EXAMPLE = `// Example C program for RiscSim.
// Press Compile: RiscSim runs your RISC-V GCC (File > Settings), links it
// against its own memory map, and loads the ELF into the simulator.
#include "riscsim.h"

static int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }
    return a;
}

int main(void) {
    print_str("fib(12) = ");
    print_int(fib(12));
    print_char('\\n');

    // Light a diagonal on the LED matrix (see the I/O tab).
    for (int i = 0; i < RS_LED_WIDTH; i++) led_set(i, i, 0x00ff4400);
    return 0;
}
`;

export const EXAMPLES: readonly Example[] = [
  {
    id: 'basics',
    title: 'Arithmetic basics',
    blurb: 'Register moves, immediates, and the four instruction formats.',
    source: `# Arithmetic basics
# Step through this in the single-cycle view and hover the
# datapath to see how each instruction uses the hardware.

main:
    li   t0, 10          # I-type: addi t0, zero, 10
    li   t1, 32
    add  t2, t0, t1      # R-type: t2 = 42
    sub  t3, t1, t0      # t3 = 22
    slli t4, t0, 2       # t4 = 40 (shift left by 2)
    and  t5, t2, t4      # t5 = 42 & 40 = 40
    xori t6, t5, 0xff    # t6 = 40 ^ 255 = 215
    lui  s0, 0x12345     # U-type: s0 = 0x12345000
    mv   a0, t2          # pseudo-instruction: addi a0, t2, 0
    li   a7, 1           # syscall 1: print integer in a0
    ecall
    li   a7, 10          # syscall 10: exit
    ecall
`,
  },
  {
    id: 'fib',
    title: 'Fibonacci loop',
    blurb: 'Branches, a loop, and the classic taken/not-taken PC mux.',
    source: `# Iterative Fibonacci: computes fib(n) and prints it.
.data
n:      .word 12

.text
main:
    la   t0, n
    lw   a0, 0(t0)        # a0 = n
    li   t1, 0            # fib(0)
    li   t2, 1            # fib(1)
loop:
    beqz a0, done         # while a0 != 0
    add  t3, t1, t2       # next = a + b
    mv   t1, t2
    mv   t2, t3
    addi a0, a0, -1
    j    loop
done:
    mv   a0, t1
    li   a7, 1
    ecall                 # print fib(n)
    li   a7, 10
    ecall
`,
  },
  {
    id: 'hazards',
    title: 'Pipeline hazards',
    blurb: 'Back-to-back dependencies: watch forwarding, then a load-use stall.',
    source: `# Data hazards in the 5-stage pipeline.
# Switch to the "Pipeline" processor and single-step.
# Hover the Forwarding unit and the ForwardA/B muxes in EX.

.data
value:  .word 100

.text
main:
    li   t0, 5
    addi t1, t0, 1        # needs t0 from EX/MEM  -> forwarded
    add  t2, t1, t0       # needs t1 (EX/MEM) and t0 (MEM/WB)
    sub  t3, t2, t1       # forwarded again

    la   t4, value
    lw   t5, 0(t4)        # load...
    addi t5, t5, 1        # ...then use it: load-use hazard -> 1 stall
    sw   t5, 0(t4)        # store data comes from forwarding too

    mv   a0, t5
    li   a7, 1
    ecall
    li   a7, 10
    ecall
`,
  },
  {
    id: 'branches',
    title: 'Control hazards',
    blurb: 'A taken branch flushes two wrong-path instructions from the pipeline.',
    source: `# Control hazards: see IF/ID and ID/EX get flushed
# when a branch is resolved in EX.

main:
    li   t0, 3
    li   t1, 0
count:
    addi t1, t1, 1
    addi t0, t0, -1
    bnez t0, count        # taken twice, falls through once
    li   a0, 99           # wrong-path while branch is resolving
    li   a1, 99           # (flushed each time the branch is taken)
    mv   a0, t1
    li   a7, 1
    ecall
    li   a7, 10
    ecall
`,
  },
  {
    id: 'function',
    title: 'Function call & stack',
    blurb: 'jal/jalr, the return address in ra, and saving registers on the stack.',
    source: `# Recursive factorial using the stack.
.text
main:
    li   a0, 5
    jal  ra, factorial    # a0 = 5! = 120
    li   a7, 1
    ecall
    li   a7, 10
    ecall

factorial:
    addi sp, sp, -8
    sw   ra, 4(sp)        # save return address
    sw   a0, 0(sp)        # save n
    li   t0, 1
    ble  a0, t0, base     # if n <= 1 return 1
    addi a0, a0, -1
    jal  ra, factorial    # a0 = (n-1)!
    lw   t1, 0(sp)        # t1 = n
    mul  a0, a0, t1       # a0 = n * (n-1)!
    j    ret_
base:
    li   a0, 1
ret_:
    lw   ra, 4(sp)
    addi sp, sp, 8
    ret
`,
  },
  {
    id: 'strings',
    title: 'Memory & strings',
    blurb: 'Byte loads, a string loop, and the print_string syscall.',
    source: `# Count the characters in a string, then print both.
.data
msg:    .asciz "Hello, RISC-V!"
newline: .asciz "\\n"

.text
main:
    la   a0, msg
    li   a7, 4
    ecall                 # print the string
    la   a0, newline
    ecall

    la   t0, msg
    li   t1, 0            # length
strlen:
    lbu  t2, 0(t0)        # load one byte
    beqz t2, done         # NUL terminator?
    addi t1, t1, 1
    addi t0, t0, 1
    j    strlen
done:
    mv   a0, t1
    li   a7, 1
    ecall                 # print 14
    li   a7, 10
    ecall
`,
  },
  {
    id: 'compressed',
    title: 'RV32C compressed',
    blurb: '16-bit instructions: the decompressor and the +2/+4 PC mux.',
    source: `# The C extension: 16-bit encodings of common instructions.
# Watch the "C exp" decompressor and the PC increment mux in IF,
# or tick "auto-compress" and see the program shrink.

main:
    c.li   t0, 7          # 2 bytes: addi t0, zero, 7
    c.li   t1, 3
    c.add  t0, t1         # t0 = 10 (compressed R-type)
    addi   t2, t0, 1000   # 4 bytes: 1000 does not fit in 6 bits
    c.mv   a0, t2         # a0 = 1010
    c.j    print          # compressed jump (+2 PC increment!)
    c.li   a0, 0          # skipped
print:
    li     a7, 1
    ecall
    li     a7, 10
    ecall
`,
  },
  {
    id: 'io',
    title: 'Memory-mapped I/O',
    blurb: 'Light LEDs from the switches: flip a switch in the I/O tab, then run.',
    source: `# Memory-mapped I/O: copy the 8 switches onto the top row of LEDs.
# Open the I/O tab, toggle some switches, and press Play.
# The loop polls forever; press Pause or Reset to stop it.

.equ LEDS,     0xF0000000
.equ SWITCHES, 0xF0001000
.equ ON,       0x0000ff88   # 0x00RRGGBB

main:
    li   s0, LEDS
    li   s1, SWITCHES
poll:
    lw   t0, 0(s1)        # read the switch word
    li   t1, 0            # LED index
row:
    srl  t2, t0, t1       # bit for this LED
    andi t2, t2, 1
    li   t3, ON
    mul  t3, t3, t2       # ON or 0
    slli t4, t1, 2        # word offset
    add  t4, t4, s0
    sw   t3, 0(t4)        # write the LED
    addi t1, t1, 1
    li   t5, 8
    blt  t1, t5, row
    j    poll
`,
  },
  {
    id: 'input',
    title: 'Console input',
    blurb: 'read_int blocks until you type into the Console; the pipeline treats it as a trap.',
    source: `# Read two numbers from the console and print their sum.
.data
prompt: .asciz "Enter two integers:\\n"
result: .asciz "sum = "

.text
main:
    la   a0, prompt
    li   a7, 4
    ecall
    li   a7, 5            # read_int -> a0 (type into the Console tab)
    ecall
    mv   s0, a0
    li   a7, 5
    ecall
    add  s0, s0, a0
    la   a0, result
    li   a7, 4
    ecall
    mv   a0, s0
    li   a7, 1
    ecall
    li   a7, 10
    ecall
`,
  },
];
