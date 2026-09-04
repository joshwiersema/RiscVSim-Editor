/* Linker script matching RiscSim's memory map:
   .text at 0x00000000, .data/.bss at 0x10000000, stack top at 0x7ffffff0. */
OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY
{
  TEXT (rx)  : ORIGIN = 0x00000000, LENGTH = 0x01000000
  DATA (rw)  : ORIGIN = 0x10000000, LENGTH = 0x01000000
}

SECTIONS
{
  .text : {
    KEEP(*(.text.init))
    *(.text .text.*)
  } > TEXT

  .rodata : { *(.rodata .rodata.* .srodata .srodata.*) } > DATA

  .data : {
    __global_pointer$ = . + 0x800;
    *(.data .data.* .sdata .sdata.*)
  } > DATA

  .bss : {
    . = ALIGN(4);
    __bss_start = .;
    *(.bss .bss.* .sbss .sbss.* COMMON)
    . = ALIGN(4);
    __bss_end = .;
  } > DATA

  __stack_top = 0x7ffffff0;

  /DISCARD/ : { *(.eh_frame) *(.comment) *(.note.*) *(.riscv.attributes) }
}
