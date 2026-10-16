/**
 * Persisted highlight-layer toggles.
 *
 * chrome.storage.local (not localStorage) because the side panel and the content
 * script both need to read the same values, and localStorage is not shared
 * between extension contexts.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LAYER_VISIBILITY, STORAGE_KEY } from "../../shared/config";
import type { HighlightLayer, QaSettings } from "../../shared/config";

export function useLayerVisibility() {
  const [layers, setLayers] = useState<Record<HighlightLayer, boolean>>({
    ...DEFAULT_LAYER_VISIBILITY,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      const settings = stored[STORAGE_KEY] as QaSettings | undefined;
      if (settings?.layers) setLayers({ ...DEFAULT_LAYER_VISIBILITY, ...settings.layers });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback((layer: HighlightLayer, visible: boolean) => {
    setLayers((current) => {
      const next = { ...current, [layer]: visible };
      const settings: QaSettings = { layers: next };
      void chrome.storage.local.set({ [STORAGE_KEY]: settings });
      return next;
    });
  }, []);

  return { layers, toggle, loaded };
}
