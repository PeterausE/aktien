const AUTH_STORAGE_KEY = 'aktien_auth';

function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function setAuth(auth) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

function clearAuth() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

async function apiFetch(path, options = {}) {
  const auth = getAuth();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;

  const res = await fetch(`api/${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = 'index.html';
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Fehler ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Gemeinsam genutzt von der Startseite (immer username="benni", siehe unten) und dem
// "Details"-Login-Modal im Dashboard (immer username="peter") - der direkte Peter-Login
// ist auf der Startseite bewusst nicht mehr erreichbar, siehe Projektnotizen.
async function performLogin(username, password) {
  const res = await fetch('api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Passwort falsch');
  const data = await res.json();
  setAuth({ token: data.token, role: data.role, username });
  return data;
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.hidden = true;

    try {
      await performLogin('benni', password);
      window.location.href = 'dashboard.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    window.location.href = 'index.html';
  });
}
