# Quest-Log

Persönliche PWA (Projekt-Register): hierarchische Quests + einfache Listen.
Vanilla HTML/CSS/JS, kein Build-Schritt, Datenhaltung über `localStorage`.

## Lokal starten

```bash
python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen.

## Deployment

Statisches Hosting (GitHub Pages, Source: Branch `main` / Ordner `/root`).
Alle Pfade sind relativ, funktioniert daher auch unter einem Unterpfad
(`https://<user>.github.io/quest-log/`).

Bei Datei-Updates die `CACHE`-Version in `sw.js` hochzählen, damit der
Service Worker die neue Version ausliefert.
