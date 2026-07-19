import logoUrl from "../../../logo.svg?url";

type BrandProps = {
  compact?: boolean;
};

export function Brand({ compact = false }: BrandProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img
        alt="nusm axolotl"
        className={compact ? "h-7 w-auto" : "h-9 w-auto"}
        src={logoUrl}
      />
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-[-0.03em] text-fd-foreground">
          nusm
        </span>
        {!compact && (
          <span className="mt-1 text-[0.64rem] font-medium uppercase tracking-[0.18em] text-fd-muted-foreground">
            state, remembered
          </span>
        )}
      </span>
    </span>
  );
}
