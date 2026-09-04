# RiscSim C runtime start-up: sets up the stack, zeroes .bss, calls main,
# then exits through the RiscSim `exit2` syscall with main's return value.
    .section .text.init
    .globl _start
_start:
    la   sp, __stack_top
    la   gp, __global_pointer$
    # zero .bss
    la   t0, __bss_start
    la   t1, __bss_end
1:  bgeu t0, t1, 2f
    sw   zero, 0(t0)
    addi t0, t0, 4
    j    1b
2:  li   a0, 0
    li   a1, 0
    call main
    li   a7, 17          # exit2(a0)
    ecall
3:  j    3b
