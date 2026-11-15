// A button that exports a backup file through the share sheet.
//
// iOS only opens the share sheet shortly after a tap. If preparing the file
// took too long, the button changes to "Backup ready — tap to save" and the
// second tap shares the already-prepared file immediately.

import { el } from './dom.js';
import { toast } from './banner.js';
import { deliverBackupFile } from '../backup.js';

/**
 * prepare: () => Promise<{ file, exportedAt, countsAsBackup } | null>
 * onDone:  called after the file was shared or downloaded.
 * noun:    what the file is called in the messages ('Backup', 'File').
 */
export function exportButton({ label, prepare, secondary = false, onDone, noun = 'Backup' }) {
  let prepared = null;
  let busy = false;
  const button = el('button', { class: secondary ? 'btn secondary' : 'btn', type: 'button', text: label });

  async function handleTap() {
    if (busy) return;
    busy = true;
    try {
      if (!prepared) prepared = await prepare();
      if (!prepared) {
        toast('There is nothing to export.');
        return;
      }
      const outcome = await deliverBackupFile(prepared);
      if (outcome === 'needs-tap') {
        button.textContent = `${noun} ready — tap to save`;
        return; // keep the prepared file for the next tap
      }
      prepared = null;
      button.textContent = label;
      if (outcome === 'shared') toast(`${noun} saved.`);
      else if (outcome === 'downloaded') toast(`${noun} downloaded.`);
      if (outcome !== 'cancelled' && onDone) onDone();
    } catch (err) {
      console.error(err);
      prepared = null;
      button.textContent = label;
      toast(`The ${noun.toLowerCase()} could not be created.`);
    } finally {
      busy = false;
    }
  }

  button.addEventListener('click', handleTap);
  return button;
}
