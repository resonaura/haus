import './styles/recovery.scss';

const api = window.hausNative;
const button = (id: string) => document.getElementById(`recovery-${id}`) as HTMLButtonElement;
const feedback = document.getElementById('recovery-feedback')!;
for (const action of ['reload', 'restart', 'copy', 'close'] as const) {
  button(action).addEventListener('click', async () => {
    button(action).disabled = true;
    try {
      if (!api) throw Error('The native connection is unavailable.');
      await api.recoveryAction(action);
      if (action === 'copy')
        feedback.textContent = 'Diagnostic copied. No home addresses or credentials are included.';
    } catch {
      feedback.textContent = 'Could not complete this action. Please close and reopen Haus.';
    } finally {
      button(action).disabled = false;
    }
  });
}
void api
  ?.getRecovery()
  .then((info) => {
    if (!info.restartRequired) return;
    button('reload').hidden = true;
    button('restart').classList.remove('is-secondary');
    document.getElementById('recovery-description')!.textContent =
      'Haus needs to restart after an unexpected error. Your home configuration is kept.';
    button('restart').focus();
  })
  .catch(() => {});
