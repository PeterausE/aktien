const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const USERS = {
  benni: { passwordHash: process.env.BENNI_PW_HASH, role: 'readonly' },
  peter: { passwordHash: process.env.PETER_PW_HASH, role: 'admin' },
};

const TOKEN_TTL_SECONDS = parseInt(process.env.SESSION_TIMEOUT, 10) || 28800;

async function login(username, password) {
  const user = USERS[username];
  if (!user || !user.passwordHash) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const token = jwt.sign(
    { username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS },
  );
  return { token, role: user.role };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültige oder abgelaufene Sitzung' });
  }
}

function requireFullAccess(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
}

module.exports = { login, requireAuth, requireFullAccess };
