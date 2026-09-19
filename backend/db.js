const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // DATE/DATETIME als Strings statt JS-Date-Objekte - vermeidet eine
  // Zeitzonen-Verschiebung beim Serialisieren nach JSON (bekannter mysql2-Stolperstein).
  dateStrings: true,
});

module.exports = pool;
