# Panel MVS – etap 1 (plan nagrywek)

Hosting: **Cloudflare Pages + baza D1**, całość w darmowym planie.
Dostęp tylko dla waszej trójki: każdy ma własne hasło.

## Co jest w paczce

```
public/index.html            – cały panel (wygląd + logika deadline'ów)
public/logo.jpg, favicon.png – wasze logo
functions/_middleware.js     – logowanie hasłem
functions/api/[[path]].js    – API zapisujące plan i urlopy w bazie
schema.sql                   – tabele bazy
wrangler.toml                – konfiguracja dla Cloudflare
```

Otwarcie `public/index.html` bezpośrednio z dysku pokazuje panel w trybie podglądu z przykładowymi danymi.

## Uruchomienie (bez terminala, ok. 15 minut)

### 1. Baza danych
1. Załóż darmowe konto na **dash.cloudflare.com**.
2. Wejdź w **Storage & Databases → D1 → Create database**, nazwa: `mvs-panel`.
3. Otwórz bazę, zakładka **Console**. Wklej całą zawartość `schema.sql` i kliknij **Execute**.
4. Skopiuj **Database ID**, który widać na stronie bazy.
5. W pliku `wrangler.toml` zamień `WKLEJ_TUTAJ_ID_BAZY` na skopiowane ID.

### 2. Kod na GitHubie
1. Na github.com utwórz **prywatne** repozytorium, np. `mvs-panel`.
2. **Add file → Upload files** i przeciągnij całą zawartość rozpakowanego folderu, razem z folderami `public` i `functions`. Struktura musi zostać taka jak wyżej.

### 3. Strona
1. W Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, wybierz repo.
2. *Build command* puste, *Build output directory* `public`.
3. **Save and Deploy**. Panel będzie pod adresem `mvs-panel.pages.dev` (lub podobnym).

Każda zmiana w repo na GitHubie wdraża się sama.

### 4. Hasła (ważne!)
Panel wpuszcza tylko po haśle, każdy z was ma własne. Hasła nie są w kodzie, tylko w ukrytych ustawieniach Cloudflare.

1. W projekcie Pages: **Settings → Variables and Secrets → Add**.
2. Dodaj 4 wpisy, każdy jako typ **Secret**, środowisko **Production**:
   - `PASS_MALVEL` – hasło Malvela
   - `PASS_VIRTUOSO` – hasło Virtuoso
   - `PASS_SAITO` – hasło Saito
   - `SESSION_SECRET` – długi losowy ciąg znaków (min. 32), nikt go nie musi pamiętać
3. **Deployments → przy ostatnim wdrożeniu „…” → Retry deployment.** Sekrety działają dopiero w nowym wdrożeniu.

Po wejściu na panel pojawi się ekran logowania: wybierasz siebie i wpisujesz swoje hasło. Logowanie trzyma 30 dni.
Zmiana hasła: edytujesz sekret i robisz ponowne wdrożenie. Zmiana `SESSION_SECRET` wylogowuje wszystkich.

## Jak działa liczenie deadline'ów

- **Czas pracy nad filmem** = planowana długość × *dni pracy na minutę* (domyślnie 0,3), minimum 3 dni.
  45 min to 14 dni pracy, a 9 min to 3 dni.
- **Wolne/urlop** się nie liczy: każdy dzień wolnego przesuwa realny termin o dzień.
  Termin nigdy nie wypada w trakcie urlopu autora.
- **Ciągłość kanału**: kanał ma mieć nowy film co *X* dni (domyślnie 4). Filmy ustawiają się w kolejce wg tego, kto najwcześniej realnie skończy:
  - kto ma krótki film, dostaje wcześniejszy slot,
  - kto robi długi film albo wyjeżdża, przesuwa się dalej,
  - pozostali wskakują wcześniej i ich terminy się zaostrzają.
- Jeśli nikt nie zdąży, panel pokazuje **dziurę w harmonogramie**.
- **Przerwa po wrzuceniu** = faktyczna długość × *dni przerwy na minutę* (domyślnie 0,15).
  Po filmie 45 min jest to 7 dni, a po 9 min 1 dzień.

Wszystkie współczynniki zmienicie w sekcji **Ustawienia rytmu**.

## Kolejne etapy
- **Etap 2**: YouTube Data/Analytics API i osobny mały Worker z cronem 2× dziennie.
  Daje automatyczne wykrywanie filmów (autor z planu nagrywek), performance, rekordy i aktualności.
- **Etap 3**: wyzwania z achievementami, miniatury z generatorem promptów, generator tagów.
