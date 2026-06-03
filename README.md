# Annuitätendarlehen-Rechner

Eine kostenlose, rein im Browser laufende Website zur Berechnung von **Annuitätendarlehen**:
Tilgungsplan, Sondertilgungen, variable Zinssätze, grafische Auswertung und Export als **Excel** und **PDF**.

👉 **Live-Demo:** *. https://d3v-t9p.github.io/Annuit-t/)*

---

## Funktionen

- **Eingaben:** Kreditsumme, Sollzinssatz (p. a.), monatliche Rate, Startmonat
- **Tilgungsplan** für die gesamte (Rest-)Laufzeit – monatlich oder jährlich
- **Sondertilgungen** je einzelner Periode eintragbar (plus Komfort-Button für jährliche Sondertilgung)
- **Variabler Zinssatz:** je Monat ein abweichender Zinssatz möglich (gilt ab diesem Monat) – ideal nach Ablauf der Zinsbindung
- **Grafische Auswertung** (Chart.js):
  - Restschuldverlauf
  - Zusammensetzung der Zahlungen (Zins / Tilgung / Sondertilgung)
  - Kumulierte Zinsen & Tilgung
- **Export** als `.xlsx` (Excel), `.pdf` und `.csv`
- **Komfort:** monatliche Rate aus anfänglicher Tilgung berechnen
- Responsives Design (Smartphone-tauglich), inkl. automatischem Dark Mode

## Bedienung

1. Kreditsumme, Zinssatz, monatliche Rate und Startmonat eingeben – der Plan rechnet **sofort live**.
2. In der **monatlichen Ansicht** kannst du in jeder Zeile:
   - den **Zinssatz** anpassen (gilt ab diesem Monat bis zur nächsten Änderung),
   - eine **Sondertilgung** eintragen.
3. Über die Buttons als **Excel / PDF / CSV** exportieren.

## Technik

Reine statische Website – **kein Build-Schritt nötig**:

- `index.html` – Aufbau der Seite
- `styles.css` – Design
- `app.js` – gesamte Logik (Berechnung, Diagramme, Export)

Eingebundene Bibliotheken (über CDN):
[Chart.js](https://www.chartjs.org/) (Diagramme),
[SheetJS](https://sheetjs.com/) (Excel),
[jsPDF](https://github.com/parallax/jsPDF) + autoTable (PDF).

## Lokal ausprobieren

Einfach `index.html` im Browser öffnen. (Falls Browser bei `file://` zickt, einen kleinen Server starten, z. B. `python3 -m http.server` und dann http://localhost:8000 öffnen.)

## Online stellen (GitHub Pages – kostenlos)

1. Diesen Branch nach `main` mergen.
2. Auf GitHub: **Settings → Pages**.
3. Unter **Build and deployment** → **Source: Deploy from a branch**.
4. **Branch: `main`**, Ordner **`/ (root)`** → **Save**.
5. Nach kurzer Zeit ist die Seite unter `https://DEIN-NAME.github.io/Annuit-t/` erreichbar.

> Hinweis: GitHub Pages ist für **öffentliche** Repositories kostenlos – ein eigener Server ist nicht nötig.

## Hinweis

Die Ergebnisse dienen nur zur Orientierung und stellen **keine Finanzberatung** dar.
Alle Berechnungen laufen lokal im Browser; es werden keine Daten übertragen. Rundungsdifferenzen sind möglich.
