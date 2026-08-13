import type { NusmGlobalOptions } from "./types.js";

let globalOptions: NusmGlobalOptions = { crossTab: false };

export const configureNusm = (options: NusmGlobalOptions): void => {
  globalOptions = { crossTab: options.crossTab };
};

export const getNusmGlobalOptions = (): Readonly<NusmGlobalOptions> =>
  globalOptions;
