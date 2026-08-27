/**
 * The parts the shared build needs and the others do not.
 *
 * Saving is not instant here — a change becomes a new version of the page a
 * moment later — so the page says where a change has got to. Silence would
 * leave a dealer wondering whether the call they just logged is on their
 * colleague's screen yet.
 */

// The store calls this when a save lands, fails, or cannot happen at all.
globalThis.FORECOURT_SAVE_STATUS = (message, kind) => {
  if (typeof toast === 'function') toast(message, kind);
};

// Export builds the CSV in the page: there is no Worker here to ask.
document.addEventListener('click', async (event) => {
  const link = event.target.closest('a[href="/api/export/stock.csv"]');
  if (!link) return;
  event.preventDefault();
  const csv = globalThis.FORECOURT_CSV();
  const filename = `forecourt-stock-${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    const downloads = globalThis.claude && await globalThis.claude.use('downloads');
    if (downloads) {
      await downloads.save({ filename, data: csv });
      return;
    }
  } catch { /* the viewer declined, or downloads are not available */ }
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    await navigator.clipboard.writeText(csv);
    toast('Download blocked here — the CSV is on your clipboard instead');
  }
});

// Someone opening a link they can only read should find that out from the page,
// not from their first change quietly failing to reach anyone.
setTimeout(() => {
  if (globalThis.FORECOURT_CAN_SAVE === false) {
    toast('View-only: you can look around, but changes will not be saved', 'bad');
  }
}, 2500);
