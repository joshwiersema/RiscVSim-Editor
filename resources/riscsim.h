/* RiscSim C support header: thin wrappers around the simulator's syscalls
 * and memory-mapped devices. Compiled freestanding (no libc). */
#ifndef RISCSIM_H
#define RISCSIM_H

typedef unsigned int u32;
typedef int i32;

static inline i32 rs_syscall(i32 num, i32 a0, i32 a1) {
    register i32 r_a0 __asm__("a0") = a0;
    register i32 r_a1 __asm__("a1") = a1;
    register i32 r_a7 __asm__("a7") = num;
    __asm__ volatile("ecall" : "+r"(r_a0) : "r"(r_a1), "r"(r_a7) : "memory");
    return r_a0;
}

static inline void print_int(i32 v)            { rs_syscall(1, v, 0); }
static inline void print_str(const char *s)    { rs_syscall(4, (i32)s, 0); }
static inline i32  read_int(void)              { return rs_syscall(5, 0, 0); }
static inline void read_str(char *buf, i32 n)  { rs_syscall(8, (i32)buf, n); }
static inline void print_char(char c)          { rs_syscall(11, c, 0); }
static inline i32  read_char(void)             { return rs_syscall(12, 0, 0); }
static inline void print_hex(u32 v)            { rs_syscall(34, (i32)v, 0); }
static inline void print_unsigned(u32 v)       { rs_syscall(36, (i32)v, 0); }
static inline void exit_program(i32 code)      { rs_syscall(17, code, 0); for (;;) {} }

/* Memory-mapped devices. */
#define RS_LED_BASE     0xF0000000u   /* u32 per LED, 0x00RRGGBB, 16x16 row-major */
#define RS_LED_WIDTH    16
#define RS_LED_HEIGHT   16
#define RS_SWITCHES     (*(volatile u32 *)0xF0001000u)  /* bit i = switch i */
#define RS_DPAD         (*(volatile u32 *)0xF0001004u)  /* up=1 down=2 left=4 right=8 centre=16 */
#define RS_CHAR_OUT     (*(volatile u32 *)0xF0002000u)  /* write a character */
#define RS_CYCLES       (*(volatile u32 *)0xF0003000u)  /* read-only cycle counter */

static inline void led_set(int x, int y, u32 rgb) {
    ((volatile u32 *)RS_LED_BASE)[y * RS_LED_WIDTH + x] = rgb;
}

#endif
