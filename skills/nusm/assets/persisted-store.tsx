import {
  createLocalStorageAdapter,
  createNusmStore,
  type NusmStore,
} from "nusm";
import { useStore } from "nusm/react";

type Preferences = { compact: boolean };

function validatePreferences(candidate: unknown): candidate is Preferences {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    "compact" in candidate &&
    typeof candidate.compact === "boolean"
  );
}

export function createPreferencesStore(): NusmStore<Preferences> {
  return createNusmStore<Preferences>(
    { compact: false },
    {
      adapter: createLocalStorageAdapter(),
      storeId: "preferences",
      persist: {
        strategy: "entire",
        hydrate: {
          validate: validatePreferences,
        },
      },
      sync: { validator: validatePreferences },
    },
  );
}

export function PreferencesToggle({
  store,
}: {
  store: NusmStore<Preferences>;
}) {
  const compact = useStore(store, (state) => state.compact);
  return (
    <button
      type="button"
      aria-pressed={compact}
      onClick={() => store.setState((state) => ({ compact: !state.compact }))}
    >
      Compact layout
    </button>
  );
}
