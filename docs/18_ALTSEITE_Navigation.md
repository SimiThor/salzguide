# Alt-Code-Analyse #9 — Mobile Bottom-Nav (Glass Tab-Bar)

Quelle: HTML + JS `salzguide-glass-bottomnav`. Stand: 2026-06-21.

---

## 1. Was es ist
Die **iOS-artige Tab-Bar unten** auf Mobile (Glassmorphism). Definiert die **4 Hauptbereiche** der App:
1. **Entdecken** (Explore) — Lupe-Icon → `/`
2. **KI-Guide** — Sparkle-Icon → öffnet den **KI-Assistenten als Overlay** (keine eigene Seite)
3. **Gespeichert** (Saved) — Bookmark-Icon → `/gespeichert/`
4. **Profil** — User-Icon → `/membership-login/` (= Login/Account)

Icons = **Phosphor-Icons** (Inline-SVG). Bestätigt die App-Informationsarchitektur.

## 2. Verhaltenslogik (übernehmen)
- **Active-State** nur für Entdecken/Gespeichert/Profil (nach Pfad). **KI ist NIE „active"** — es ist eine **Aktion** (öffnet Chat), kein Ziel-Tab.
- **Spot-Detailseiten** (`single-post`): kein Tab aktiv; **Entdecken-Button = „Zurück"** — wenn man von Start/Explore kam → `history.back()`, sonst → `/`. (Native-App-Gefühl: zurück zur Liste statt Reload.)
- KI-Button wartet robust aufs Chat-Element und triggert es.

## 3. ⚠️ Notiz: Chatbot-Wildwuchs
Der Code referenziert **mehrere Chat-Systeme parallel**: `open-chatbase-bottomnav` (Chatbase), `open-aiengine-chat` (AI Engine), plus der „Toni"/„Anton"-Bot. → Bestätigt Antons „gepfuscht/verstreut"-Problem. **Neubau: EIN Assistent** (Claude „Anton"), an EINEN Trigger gebunden.

## 4. Konsequenzen fürs Neubau
1. **Bottom-Tab-Bar als zentrale Mobile-Navigation** (Next.js Client-Component, Active-State aus dem Router). Glass/Blur-Stil beibehalten → iOS-2026-Look.
2. **4 Tabs:** Entdecken · KI · Gespeichert · Profil. KI öffnet den Assistenten als **Bottom-Sheet/Overlay** über jeder Seite.
3. **Profil-Tab = Account/Login:** eingeloggt → Profil (gespeicherte Spots, Pro-Status, Einstellungen); ausgeloggt → Login/Join. → fügt sich in Auth-Konzept ein.
4. **Native Zurück-Geste** auf Detailseiten nachbilden (Router-Back statt Hard-Reload).
5. **Desktop:** Top-Nav (Logo, Entdecken, KI-Guide, Über uns, Gespeichert, English, Login) wie auf den Detailseiten gesehen — responsive Gegenstück zur Tab-Bar.

→ Bestätigt App-Struktur: **Explore / KI / Gespeichert / Profil** als Top-Level-Bereiche.
