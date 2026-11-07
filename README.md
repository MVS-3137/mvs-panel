# Panel MVS – etap 1 (plan nagrywek)

Hosting: **Cloudflare Pages + baza D1**, całość w darmowym planie.
Dostęp tylko dla waszej trójki: każdy ma własne hasło.

## Co jest w paczce

```
public/index.html            – cały panel (wygląd + logika deadline'ów)
public/logo.jpg, favicon.png – wasze logo
functions/_middleware.js     – logowanie hasłem
functions/api/[[path]].js    – API panelu (plan, urlopy, dane YouTube)
functions/oauth/[[path]].js  – łączenie z kanałem YouTube
lib/yt.js                    – pobieranie i liczenie statystyk YouTube
cron/                        – „budzik”: osobny mini-Worker, co godzinę odświeża dane
schema-etap2.sql             – nowe tabele na etap 2 (dla istniejącej bazy)
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

## Etap 2: YouTube (performance, rekordy, aktualności)

### A. Nowe tabele w bazie
D1 → `mvs-panel` → **Console**. Wklej **całą jedną linię** z pliku `schema-etap2.sql` i kliknij **Execute**.

### B. Klucze Google (Google Cloud, ok. 10 min)
1. Wejdź na **console.cloud.google.com** (konto Google, które jest właścicielem kanału) i utwórz projekt, np. `mvs-panel`.
2. **APIs & Services → Library**: wyszukaj i włącz (**Enable**) dwa API:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
3. **Google Auth Platform** (dawniej „OAuth consent screen”) → **Get started**:
   - nazwa aplikacji: `Panel MVS`, e-mail: wasz,
   - *Audience*: **External**.
4. W **Audience** kliknij **Publish app** (stan *In production*).
   Bez tego połączenie wygasa co 7 dni. Weryfikacja Google nie jest potrzebna do własnego użytku.
5. **Clients → Create client** → typ **Web application**.
   W *Authorized redirect URIs* dodaj: `https://ADRES-PANELU.pages.dev/oauth/callback` (wasz adres panelu).
6. Skopiuj **Client ID** i **Client secret**.

### C. Sekrety w Cloudflare
Pages → `mvs-panel` → **Settings → Variables and Secrets**, typ **Secret**:
- `GOOGLE_CLIENT_ID` – z punktu B6,
- `GOOGLE_CLIENT_SECRET` – z punktu B6,
- `CRON_KEY` – długi losowy ciąg (ten sam wpiszecie w budziku, punkt E).

Potem **Retry deployment**.

### D. Połączenie kanału
1. Panel → zakładka **Performance** → **Połącz z YouTube**.
2. Wybierz konto, na którym jest kanał. Jeśli to konto marki, wybierz kanał na liście.
3. Google pokaże „Aplikacja nie została zweryfikowana”: kliknij **Zaawansowane → Przejdź do Panel MVS**.
4. Zaznacz obie zgody (YouTube i YouTube Analytics).

Pierwsze pobranie trwa chwilę. Historia starych filmów (rekordy 24 h / 7 / 14 / 28 dni) dociąga się po 10 filmów przy każdym odświeżeniu.

### E. Budzik (odświeżanie co godzinę)
Strony Pages nie mają harmonogramu, dlatego w folderze `cron` jest mini-Worker, który co godzinę (o :05) budzi panel.
1. W `cron/wrangler.toml` wpisz adres panelu w `PANEL_URL`.
2. Cloudflare: **Workers & Pages → Create → Workers → Import a repository**, wybierz to samo repo.
   - *Project name*: `mvs-budzik`
   - **Advanced settings → Root directory**: `cron`
   - *Deploy command*: `npx wrangler deploy`
3. Po wdrożeniu: Worker `mvs-budzik` → **Settings → Variables and Secrets** → Secret `CRON_KEY` z tą samą wartością co w panelu.

### Jak liczona jest ocena filmu
- **Wynik %** = wyświetlenia filmu ÷ mediana 10 ostatnich filmów **tej samej kategorii** (War Thunder / inne / shorty) w tym samym wieku.
  Film 3-dniowy porównuje się z tym, ile poprzednie filmy miały po 3 dniach. 100% = typowo, 120%+ = ponad normę.
- **REKORD** świeci się przy filmie, który ma najlepszy wynik po 24 h / 7 / 14 / 28 dniach (bez shortów).
  „🔥 na rekordowym kursie” oznacza młody film, który w tym wieku bije wszystkie poprzednie.
- **Autor** pochodzi z planu nagrywek: tytuł filmu na YouTube jest porównywany z tytułami w planie, a projekt zamyka się sam.
  Jeśli nic nie pasuje, film dostaje listę „kto montował?”.
- **Kategoria**: z planu, a dla filmów spoza planu po tytule i tagach („War Thunder”). Shorty to filmy do 3 minut.
- **Aktualności**: nowy film, nowy rekord, „Film odżywa!”, kamienie milowe subów, film bez autora.
  „Film odżywa!” = stary film (45+ dni) ma w dobę co najmniej 3× więcej wyświetleń niż zwykle.
  „Nowy wspierający” nie wchodzi w grę: YouTube nie udostępnia danych o członkostwach i Super Thanks małym aplikacjom.

## Kolejne etapy
- **Etap 3**: wyzwania z achievementami, miniatury z generatorem promptów, generator tagów.
