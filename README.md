# LUKS Mobil – Arbeitsprotokolle

Eine offline nutzbare, installierbare Handy-App für Arbeitsprotokolle auf Baustellen – im ruhigen Blau-Grün-Stil des LUKS-Rechnungsprogramms.

## Nutzen

- Arbeitsprotokolle für Baustellen, Projekte und Kunden mit einem Zeitraum von/bis erfassen
- Mehrere Positionen pro Protokoll dokumentieren; gleiche Tätigkeiten werden zusammengefasst
- Arbeitsstunden, Mitarbeiter, Tätigkeiten, Maschinen, Material, Bemerkungen und Baustellenfotos dokumentieren
- Arbeitszeit unterwegs starten, stoppen und in ein Protokoll übernehmen
- Entwürfe prüfen und als abgeschlossen markieren
- Kundenstamm mit Ansprechpartnern, Adressen, Telefon und E-Mail lokal verwalten
- Tätigkeitenstamm mit Standardmaschine und -material lokal verwalten
- Arbeitsprotokolle als Rechnungsübergabe exportieren oder vom Handy aus teilen
- Lokale Datensicherung exportieren und wieder einspielen

## Auf Android und iPhone installieren

LUKS Mobil ist eine installierbare Web-App. Sie benötigt keine App-Store-Veröffentlichung, muss aber über eine sichere Internetadresse mit https:// geöffnet werden. Direkt über file:// geöffnete Dateien können nicht installiert werden.

1. Den Ordner auf eine HTTPS-Webadresse veröffentlichen.
2. Diese Adresse auf dem Handy öffnen.
3. Android: In Chrome oder Edge **App installieren** oder **Zum Startbildschirm hinzufügen** wählen.
4. iPhone/iPad: Die Adresse in Safari öffnen, **Teilen** antippen und **Zum Home-Bildschirm** auswählen.

Nach der Installation startet LUKS Mobil im Vollbild wie eine normale App. Die Funktion **App installieren** unter **Mehr** zeigt auf dem jeweiligen Gerät die passenden Schritte an.

Arbeitsprotokolle und verkleinerte Fotos liegen im Browser (`localStorage`); Kunden- und Tätigkeitenstamm liegen in einer lokalen Browserdatenbank (`IndexedDB`). Die App greift nicht auf die bestehende `rechnungen.db` zu; für eine spätere Synchronisierung wäre eine sichere Schnittstelle zwischen Handy und Desktop erforderlich.
