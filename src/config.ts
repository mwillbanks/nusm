import type { NusmGlobalOptions } from "./types.js";

let globalOptions: NusmGlobalOptions = {};

export const configureNusm = (options: NusmGlobalOptions): void => {
  globalOptions = { sync: options.sync };
};

export const getNusmGlobalOptions = (): Readonly<NusmGlobalOptions> =>
  globalOptions;
