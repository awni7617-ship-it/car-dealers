/**
 * The two things the standalone build has to do differently.
 *
 * The deployed app asks the Worker for a CSV and lets the browser download it,
 * and it never runs out of storage. A single file opened from disk has neither
 * luxury, so export is built in the page and the viewer is told, once, if the
 * browser is refusing to keep anything.
 */

// The deployed app links CSV export at the Worker; here it is built in-page.
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
  } catch { /* fall through to the browser's own download */ }
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

// Say so once if the browser refuses to keep anything.
let warnedEphemeral = false;
setInterval(() => {
  if (globalThis.FORECOURT_EPHEMERAL && !warnedEphemeral) {
    warnedEphemeral = true;
    toast('This browser is not saving data — it will be gone when you close the tab', 'bad');
  }
}, 4000);

