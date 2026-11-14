/** Modal message for a finished game: opponent left, or the clients' simulations disagreed. */
export function showEndDialog(kind: 'desync' | 'peer-left', detail: string, onClose: () => void): void {
  const dialog = document.createElement('dialog');
  dialog.dataset.testid = kind === 'desync' ? 'desync-dialog' : 'opponent-left';
  const title = document.createElement('h2');
  title.textContent = kind === 'desync' ? 'Out of sync' : 'Opponent left';
  const text = document.createElement('p');
  text.textContent = detail;
  const ok = document.createElement('button');
  ok.textContent = 'Back to lobby';
  ok.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose();
  });
  dialog.append(title, text, ok);
  document.body.append(dialog);
  dialog.showModal();
}
