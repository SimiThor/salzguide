# Apple-Wurzelzertifikate (öffentlich)

Gegen diese Wurzeln prüft `lib/apple-purchase.ts` die Signatur jeder App-Store-Transaktion
und jeder Server-Benachrichtigung. Es sind öffentliche Zertifikate, keine Geheimnisse.

Quelle: https://www.apple.com/certificateauthority/ (Abschnitt "Apple Root Certificates"),
heruntergeladen am 23.10.2026.

| Datei | Name | SHA-256 | gültig bis |
|---|---|---|---|
| AppleRootCA-G3.cer | Apple Root CA - G3 | `63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179` | 30.04.2039 |
| AppleRootCA-G2.cer | Apple Root CA - G2 | `c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050` | 30.04.2039 |

Die App-Store-Signaturen hängen heute an G3. G2 liegt als Reserve dabei (gleicher Aussteller,
Apple prüft zusätzlich eigene Erweiterungen im Blatt- und Zwischenzertifikat, siehe die
Bibliothek). Weitere Wurzeln NICHT ohne Grund aufnehmen: Jede Wurzel hier ist Vertrauen.

`index.ts` trägt dieselben Bytes als Base64 (damit der Bundler nichts "vergessen" kann) und
die Prüfsummen. `npm run app-purchase:check` vergleicht Datei und Modul Byte für Byte und gegen
die Tabelle oben. Nachprüfen: `shasum -a 256 AppleRootCA-G3.cer`.

Aktualisieren: neue Datei von der Apple-Seite laden, Prüfsumme gegen die Seite und diese
Tabelle prüfen, `index.ts` und README zusammen ändern.
