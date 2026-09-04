/** RiscSim chip logo, rendered inline so it scales crisply and needs no asset pipeline. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 256 256" aria-label="RiscSim logo" role="img">
      <g fill="#6b78c4">
        <rect x="70" y="10" width="12" height="14" rx="2" /><rect x="122" y="10" width="12" height="14" rx="2" /><rect x="174" y="10" width="12" height="14" rx="2" />
        <rect x="70" y="232" width="12" height="14" rx="2" /><rect x="122" y="232" width="12" height="14" rx="2" /><rect x="174" y="232" width="12" height="14" rx="2" />
        <rect x="10" y="70" width="14" height="12" rx="2" /><rect x="10" y="122" width="14" height="12" rx="2" /><rect x="10" y="174" width="14" height="12" rx="2" />
        <rect x="232" y="70" width="14" height="12" rx="2" /><rect x="232" y="122" width="14" height="12" rx="2" /><rect x="232" y="174" width="14" height="12" rx="2" />
      </g>
      <rect x="24" y="24" width="208" height="208" rx="30" fill="#3346a8" />
      <path d="M68 76 L128 184 L188 76" fill="none" stroke="white" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="128" cy="186" r="9" fill="#3dd9c0" />
    </svg>
  );
}
