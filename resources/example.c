// Example C program for RiscSim. Compile with File > Compile C & Load
// (needs a riscv32/riscv64-unknown-elf-gcc on your PATH or in Settings).
#include "riscsim.h"

static int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }
    return a;
}

int main(void) {
    print_str("fib(12) = ");
    print_int(fib(12));
    print_char('\n');

    // Light a diagonal on the LED matrix.
    for (int i = 0; i < RS_LED_WIDTH; i++) led_set(i, i, 0x00ff4400);

    return 0;
}
