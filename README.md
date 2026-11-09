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
schema-etap3.sql             – nowe tabele na tablicę wyzwań
lib/ach.js                   – cel subów i achievementy
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

## Etap 3: Tablica wyzwań

### Uruchomienie
1. Konsola D1: wklej jedną linię z `schema-etap3.sql` i kliknij **Execute**.
2. Wgraj na GitHuba nowe pliki z zachowaniem folderów (najpewniej całą paczkę z zipa).
   Sprawdź, czy `functions/api/[[path]].js` ma nawiasy w nazwie.
3. Przy pierwszym odświeżeniu (cron albo „Odśwież teraz”) tablica startuje sama:
   - cel 20 000,
   - pierwszy punkt wykresu = dzisiejsza liczba subów,
   - achievementy liczą się od tej chwili.

### Wykres i cel
- **Punkt na wykresie** dochodzi co poniedziałek rano (pierwsze odświeżenie po 6:00).
- **Prognoza** jest liczona z przyrostu subów w ostatnich 28 dniach (YouTube Analytics, aktualizacja raz dziennie).
  Pod wykresem widać przybliżoną datę osiągnięcia celu.
- **Liczba subów** jest dokładna z Analytics, a gdy nie jest dostępna, publiczna (YouTube zaokrągla ją do 3 cyfr).
- **„Zmień cel”** resetuje wykres: rysuje się od nowa, od dzisiejszej liczby subów.

### Achievementy
- 36 sztuk w 5 grupach: Common, Uncommon, Rare, Epic, Legendary.
  Zakryte pokazują tylko obrys i „?”. Po zdobyciu odkrywają ikonę, nazwę, opis (po najechaniu) i stempel z nickiem.
- Achievementy kanałowe (np. cel subów, serie słabych filmów) nie mają stempla.
- **Ręczne odblokowanie:**
  - „It's Dangerous to Go Alone”: tylko Saito, z wyborem dwóch osób,
  - „Toss a Coin to Your Witcher”: tylko Saito, bo YouTube nie udostępnia liczby wspierających.
- **Half-Life 3** liczy przesunięcia w planie: edycję, która przesuwa start na później albo wydłuża planowany film.
- **Skill Issue** i **How Did We Get Here?** zamiast CTR (którego API YouTube nie udostępnia) używają wyników pierwszej doby i kolejnych okien.

## Generator tagów

Zakładka **Tagi**: opisujesz film, klikasz **Generuj tagi**, dostajesz 8–15 tagów w limicie 500 znaków, gotowych do wklejenia.

Skąd biorą się tagi:
- **🔎 szukane:** podpowiedzi wyszukiwarki YouTube, czyli frazy, które ludzie naprawdę wpisują. To nieoficjalne źródło Google; jeśli kiedyś przestanie odpowiadać, generator działa dalej bez tej etykiety.
- **★ 2×:** wasze tagi z przeszłości; liczba mówi, ile razy lepiej od typowego filmu radziły sobie filmy z tym tagiem (liczone od 2 filmów wzwyż).
- **kanał:** stałe tagi, które macie na większości filmów tej kategorii.
- **AI:** darmowy model Llama 3.3 w Cloudflare Workers AI.

**Workers AI:** w `wrangler.toml` jest już binding `AI`, nic nie trzeba klikać. Darmowy limit to 10 000 „neuronów” dziennie. Jedno generowanie zużywa ich ułamek, więc wystarczy na kilkadziesiąt generowań dziennie; po przekroczeniu AI zwróci błąd, a panel pokaże tagi bez części AI. Nic nie zostanie naliczone na planie Free.

**Kopiuj dla Claude** kopiuje gotowe polecenie (opis + dane z panelu) do wklejenia w czacie z Claude, gdy chcecie najlepszej jakości.

## Miniatury (CTR)

1. Konsola D1: wklej linię z `schema-miniatury.sql` i kliknij **Execute**.
2. Google Cloud → APIs & Services → Library: włącz **YouTube Reporting API** (trzecie API obok Data i Analytics).
3. Wgraj nową paczkę na GitHuba.

Przy najbliższym odświeżeniu panel zakłada w YouTube raport `channel_reach_basic_a1` (dzienny CTR i wyświetlenia miniatur każdego filmu).
- Pierwsze dane mogą przyjść do 48 h później.
- YouTube daje wstecz tylko ok. 30 dni.

**TOP 5 – pierwsza doba:** CTR z dnia premiery i następnego dnia, dla filmów wydanych w okresie objętym raportami.

**TOP 5 – cały czas:** dla starszych filmów wgrajcie raz eksport ze Studio:
1. Statystyki → Tryb zaawansowany → zakres „Od początku”, upewnij się, że widać kolumnę CTR wyświetleń.
2. Eksportuj → CSV i rozpakuj zip.
3. W zakładce Miniatury kliknij **Wgraj eksport ze Studio** i wybierz plik z danymi tabeli.

Shorty są pomijane. Progi: doba – min. 200 wyświetleń miniatury; cały czas – tylko filmy z min. 3000 wyświetleń.

**Kopiuj prompt** składa polecenie z zaznaczonymi miniaturami (ID filmów) i opisem nowego filmu. Wklejacie je w czacie z Claude i dostajecie gotowy prompt po angielsku do generatora grafik.

## Konkurencja

1. Konsola D1: wklej całą linię z `schema-konkurencja.sql` i kliknij **Execute**.
   Tworzy dwie tabele i wpisuje kanały startowe oraz ich stan sprzed ~30 dni (dane z vidIQ), żeby przyrosty były widoczne od pierwszego dnia.
2. Wgraj nową paczkę na GitHuba.

Działanie:
- Raz dziennie panel pobiera suby, wyświetlenia i ikony wszystkich kanałów: jedno zapytanie do YouTube na 50 kanałów.
- Przyrost liczony jest względem pomiaru sprzed 28 dni.
- **War Thunder:** stała lista (TV Kowalowe, Turteł, WODZU, MVS, BommerTV, Blekczo, kryptyda), bez dodawania i usuwania.
- **Polskie kanały gamingowe:** wklejasz link albo @nazwę kanału, klikasz **Dodaj**; ✕ usuwa kanał (MVS nie da się usunąć).
- YouTube zaokrągla publiczną liczbę subów do 3 cyfr, dlatego dokładniejszym miernikiem wzrostu są wyświetlenia.

## Zapisy streamów

Panel rozpoznaje zapisy transmisji na żywo po polu `liveStreamingDetails` z YouTube i wyklucza je z:
- Performance i median,
- Rekordów,
- achievementów,
- Miniatur,
- generatora tagów,
- dopasowania do planu nagrywek.

Przegląd: Performance → **Streamy**. Pomyłki poprawisz ręcznie:
- 📡 przy filmie: „to stream”,
- „To nie stream” w zakładce Streamy.

Migracja: konsola D1 → linia z `schema-streamy.sql`.

## Filmy dla wspierających

YouTube nie oznacza takich filmów w API, więc panel rozpoznaje je po wzorze z kanału MVS:
- w tytule jest „BEZ CENZURY”, „dla wspierających” albo „members only”,
- **albo** film ma 3+ dni, mniej niż 100 wyświetleń i co najmniej 5% polubień (oglądają go tylko wspierający).

Sprawdzone na 21 filmach kanału: 21/21 trafnie, także „Zabijesz Mnie to KRADNE Twój BR” bez dopisku w tytule.

Takie filmy są wykluczone ze wszystkich statystyk, tak samo jak streamy, i nie zamykają projektów w planie nagrywek.

Przegląd: Performance → **Dla wspierających**. Pomyłki poprawisz ręcznie:
- 💎 przy filmie: „tylko dla wspierających”,
- „To film publiczny” w tej liście.

Migracja: konsola D1 → linia z `schema-wspierajacy.sql`.

## Oceny

Zakładka **Oceny** pokazuje avatar każdego z was, tytuły (najedź, żeby zobaczyć opis) oraz dwie listy: **Co idzie świetnie** i **Do poprawki**. Wszystkie porównania są względem średniej kanału, nie między osobami.

**Tytuły:**
- **Z waszej listy:** SZEF, Montażysta, Nauczyciel, Ulubieniec widzów, Obibok, MVS Panel Enjoyer, Streamer, Społeczniak, Wędkarz, YouTube na pełny etat, Kiedyś mi się uda..., Rekordzista.
- **Dodatkowe:** Grafik (CTR), Speedrunner (najszybciej od startu w planie do premiery), Maratończyk (najdłuższe filmy), Pewniak (najczęściej przebija typowy wynik), Turysta (najwięcej filmów spoza War Thunder).

**Ręcznie ustawia tylko Saito** (widzi to tylko on, bez powiadomień):
- **Montażysta:** domyślnie automatycznie wg utrzymania uwagi; panel podpowiada, komu się należy.
- **Streamer:** zawsze ręcznie.

**Skąd dane:**
- **YouTube Analytics, raz dziennie:** wyświetlenia, suby i % obejrzenia z 90 dni; hook = % widzów po 30 sekundach (krzywa utrzymania, do 4 filmów dziennie).
- **Panel:** CTR (zakładka Miniatury), plan nagrywek, licznik kliknięć w panelu.

**Avatary** leżą w `public/avatars/` (malvel.png, virtuoso.png, saito.png). Podmiana pliku zmienia avatar.

Migracja: konsola D1 → linia z `schema-oceny.sql`.

## Limity darmowej bazy D1 (ważne)

Darmowy plan D1 daje dziennie 5 mln odczytów i 100 tys. zapisów wierszy. Pierwsze wersje panelu przekraczały odczyty, dlatego:
- co godzinę odświeżane są tylko filmy do 32 dni, pełna lista raz dziennie (usunięte filmy też wykrywane raz dziennie);
- film zapisuje się tylko wtedy, gdy coś się w nim zmieniło;
- migawki wyświetleń: co godzinę do 50 h po premierze, potem raz dziennie do 31 dni;
- CTR miniatur starszy niż 35 dni jest zwijany do sum w tabeli `reach_sum`; shorty są pomijane;
- zakładki Miniatury, Konkurencja i Oceny są liczone raz i trzymane w `kv` (cache), kasowane po nowych danych;
- przeglądarka pobiera dane zakładki dopiero po wejściu w nią i odświeża panel co 15 min tylko przy otwartej karcie.

Migracja: konsola D1 → linia z `schema-limity.sql`.
Zużycie sprawdzisz w Cloudflare: Storage & Databases → D1 → panel Usage po prawej.

## Etap: kalendarz, pory wrzucania, typ filmu, wynik miniatur
- Migracja: `schema-kalendarz.sql` (kolumna `wt_override`, tabela `thumb_stats`, ustawienie `favorShift`).
- Plan nagrywek: kalendarz (ten + następny miesiąc), najlepsze dni tygodnia (`lib/times.js`, raz dziennie, 1 zapytanie Analytics) i godzina premiery; termin może przesunąć się o `favorShift` dni na lepszy dzień (wcześniej ≥ +5%, później ≥ +10%).
- Performance: klik w tag WT / inne zmienia typ filmu na stałe (`POST /api/videos/:id/wt`).
- Miniatury: wynik 0–100 (`lib/thumbs.js`): 40% CTR na tle zasięgu, 25% zasięg, 20% widzowie bez suba, 15% średni % obejrzenia; dane o widzach pobierane po 4 filmy na odświeżenie.
- Aktualności: „Kiepski początek” (slow_start: długi film po 24 h < 60% mediany 10 poprzednich z tej samej kategorii) i zmiany tytułów z Ocen (grade, raz dziennie, bez Montażysty i Streamera).
- Podpowiedzi panelu (Plan nagrywek): plan przejścia 12 tyg. od 9 lis 2026 (tydzień, proporcja WT : nowe gry, test gier wg progów 45% / 25% mediany WT po 28 dniach, shorty 3–5/tydz., zwiad przed nową grą, nazwa gry w tytule, let's playe, słaby start, Iwo Jima) i propozycje „kto i co” dla wolnych osób z ich bibliotek Steam. Migracja: `schema-gry.sql` (tabela `games`, kolumna `projects.game`). Każdy edytuje swoją listę w karcie „Moje gry”.
- „Najpierw dla wspierających”: `schema-wspierajacy-najpierw.sql` (kolumny `videos.public_at`, `projects.public_at`). Film czeka wykluczony (members_override=1) do public_at; przy odświeżeniu po tej godzinie panel ustawia published=public_at, kasuje wcześniejsze migawki i traktuje go jak nowy film (autor z planu, aktualności, achievementy).
