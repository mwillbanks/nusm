import type { SVGProps } from "react";

export type NusmLogoProps = SVGProps<SVGSVGElement>;

export function NusmLogo({
  "aria-label": ariaLabel = "nusm logo",
  height = 18,
  width = 34,
  ...props
}: NusmLogoProps) {
  return (
    <svg
      aria-label={ariaLabel}
      height={height}
      role="img"
      viewBox="0 0 148 78"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <ellipse cx="74" cy="40" fill="#22d3ee" rx="46" ry="30" />
      <ellipse cx="74" cy="44" fill="#38bdf8" rx="36" ry="22" />
      <ellipse cx="64" cy="42" fill="#020617" rx="4" ry="5" />
      <ellipse cx="84" cy="42" fill="#020617" rx="4" ry="5" />
      <path
        d="M26 34 C8 24, 6 12, 14 6"
        fill="none"
        stroke="#0ea5e9"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M28 40 C8 34, 4 26, 10 20"
        fill="none"
        stroke="#0ea5e9"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path
        d="M122 34 C140 24, 142 12, 134 6"
        fill="none"
        stroke="#0ea5e9"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M120 40 C140 34, 144 26, 138 20"
        fill="none"
        stroke="#0ea5e9"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}
