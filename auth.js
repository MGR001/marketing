document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-auth-logout]');
  if (!button) return;
  button.disabled = true;
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}'
    });
  } catch {}
  window.location.assign('/login');
});
