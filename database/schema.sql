-- Positionen Tabelle
CREATE TABLE positions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  depot_name VARCHAR(100) NOT NULL,
  isin VARCHAR(12) NOT NULL,
  wertpapier_name VARCHAR(255) NOT NULL,
  assetklasse ENUM('aktie', 'etf', 'anleihe') NOT NULL,
  menge DECIMAL(10,4) NOT NULL,
  kaufdatum DATE NULL, -- oft nicht aus Broker-Screenshots/-Exporten ersichtlich, daher optional
  kaufpreis_per_einheit DECIMAL(10,4) NOT NULL,
  broker VARCHAR(100),
  yahoo_symbol VARCHAR(20) NULL, -- Cache der ISIN->Symbol-Aufloesung fuer den Kurs-Refresh
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX(depot_name),
  INDEX(assetklasse),
  INDEX(isin)
);

-- Tägliche Snapshots (Kursdaten)
CREATE TABLE daily_snapshots (
  id INT PRIMARY KEY AUTO_INCREMENT,
  position_id INT NOT NULL,
  snapshot_date DATE NOT NULL,
  current_price_per_unit DECIMAL(10,4) NOT NULL,
  current_total_value DECIMAL(15,2) NOT NULL,
  gain_loss_absolute DECIMAL(15,2),
  gain_loss_percent DECIMAL(6,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES positions(id),
  INDEX(position_id),
  INDEX(snapshot_date),
  UNIQUE(position_id, snapshot_date)
);

-- Import-History
CREATE TABLE import_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  import_source VARCHAR(50),
  positions_imported_count INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
