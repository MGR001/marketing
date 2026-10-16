const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const loginSubmit = document.querySelector('#login-submit');
const loginNext = new URLSearchParams(window.location.search).get('next') || '/';

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;
  loginSubmit.querySelector('span').textContent = 'Signing in…';
  const formData = new FormData(loginForm);
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
        next: loginNext
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign-in failed. Please try again.');
    window.location.assign(result.redirectTo || '/');
  } catch (error) {
    loginError.textContent = error.message || 'Could not connect to the sign-in service.';
    loginError.hidden = false;
    loginSubmit.disabled = false;
    loginSubmit.querySelector('span').textContent = 'Sign in';
  }
});
