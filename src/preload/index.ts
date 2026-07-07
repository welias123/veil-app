import { exposeVeilApi } from "./chrome";
import { runContentProtections } from "./content";

/**
 * Unified preload used by every web contents (chrome window, overlay, internal
 * veil:// pages, and web tabs). It self-gates by origin:
 *   - Privileged origins (file:// chrome UI, veil:// internal pages) get the
 *     full window.veil bridge.
 *   - Everything else (real websites) gets only the privacy protections and
 *     never sees the privileged API.
 *
 * This lets any tab navigate to veil://search etc. without pre-choosing a
 * preload, while keeping arbitrary sites sandboxed from the app API.
 */
const privileged = location.protocol === "veil:" || location.protocol === "file:";

if (privileged) {
  exposeVeilApi();
} else {
  runContentProtections();
}
