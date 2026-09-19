# Aktienaufstellung

Zentrale Verwaltung mehrerer Depots mit automatischer Kursabfrage und täglichen Briefings.

## Features
- Multi-Depot-Verwaltung
- Screenshot-basierter Import
- Automatische Kursabfrage (täglich 09:15 Uhr)
- Email-Briefing (täglich 09:00 Uhr)
- Charts für verschiedene Zeiträume
- Filterung nach Depot & Assetklasse

## Tech-Stack
- Frontend: HTML5, CSS3, Vanilla JS
- Backend: Node.js / Express
- Datenbank: MySQL
- Automatisierung: n8n Workflows
- Charts: Chart.js

## Logins
- **Benni** (Read-Only, Demo)
- **Peter** (Full Access)

Passwörter werden nicht im Klartext gespeichert oder committed (siehe `.env.example`).

## Deployment
Läuft containerisiert auf dem Hostinger-Server unter `/docker/aktien/` und wird über
Traefik als Reverse Proxy unter `gawborbeck.cloud/aktien` geroutet (analog zum
bestehenden Projekt `ausstellung-app`). Details zum Compose-/Traefik-Setup folgen in
Phase 4/5.

## Installation
(Wird in Phase 4 dokumentiert)
