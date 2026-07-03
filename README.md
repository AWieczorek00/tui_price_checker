# Monitor cen hoteli na TUI.pl

Ten program służy do automatycznego, codziennego sprawdzania ceny oraz dostępności wybranego hotelu na stronie TUI.pl. Program korzysta z zainstalowanej w systemie przeglądarki **Microsoft Edge**, dzięki czemu działa bardzo szybko, w tle i nie obciąża komputera. Działa w tle i wysyła powiadomienia na pulpit systemu Windows, gdy cena hotelu spadnie.

---

## 1. Pierwsze kroki (Instalacja)

Przed pierwszym uruchomieniem musisz zainstalować wymagane pakiety Node.js.

1. Otwórz terminal (PowerShell lub CMD) w folderze projektu.
2. Zainstaluj zależności projektu:
   ```bash
   npm install
   ```
*(Uwaga: Program korzysta z systemowej przeglądarki Edge, dzięki czemu nie musisz pobierać dodatkowych, zajmujących miejsce przeglądarek dla Playwright).*

---

## 2. Konfiguracja (`config/config.json`)

Przed pierwszym uruchomieniem skopiuj plik szablonu `config/config.json.example` i zapisz go jako `config/config.json`. Następnie uzupełnij w nim swoje dane (np. adresy e-mail i opcjonalnie hasło aplikacji Gmail).

Plik `config/config.json` zawiera ustawienia działania programu. Możesz go edytować w dowolnym edytorze tekstu:

*   **`hotelUrl`**: Pełny adres URL oferty hotelu na TUI.pl (skopiowany z przeglądarki, najlepiej ze skonfigurowaną już datą, liczbą osób i pokojem).
*   **`enableDesktopNotifications`**: `true` lub `false` (włącza/wyłącza powiadomienia wyskakujące na pulpicie Windows).
*   **`enableLogFile`**: `true` lub `false` (zapisywanie historii sprawdzeń do pliku tekstowego).
*   **`logFilePath`**: Nazwa pliku z historią cen (domyślnie `tui_prices.log` w katalogu głównym projektu).
*   **`priceLimitAlert`**: Opcjonalny limit ceny. Jeśli cena spadnie poniżej tej kwoty, otrzymasz dodatkowe powiadomienie o okazji cenowej. Ustaw `null` jeśli nie chcesz z tego korzystać.

---

## 3. Śledzenie zmian cen (`config/state.json`)

Program automatycznie tworzy i aktualizuje plik `config/state.json`, w którym zapisuje ostatnią znaną cenę hotelu. Podczas każdego uruchomienia porównuje nową cenę z zapisaną:
*   Jeśli cena spadnie, otrzymasz powiadomienie na pulpicie: `"TUI: CENA SPADŁA! 🎉 Cena spadła o X zł!"`.
*   Jeśli wzrośnie lub pozostanie bez zmian, program odpowiednio to zaloguje.

---

## 4. Ręczne uruchomienie testowe

Aby sprawdzić, czy program działa prawidłowo, możesz uruchomić go ręcznie w konsoli:
```bash
npm start
```
*(Alternatywnie: `node src/index.js`)*

Program powinien:
1. Uruchomić w tle przeglądarkę Edge.
2. Wejść na stronę hotelu.
3. Odczytać cenę lub poinformować o braku miejsc.
4. Wyświetlić powiadomienie w systemie Windows oraz zapisać wynik w pliku logów `tui_prices.log` w katalogu głównym.

---

## 5. Konfiguracja automatycznego uruchamiania w tle (raz dziennie)

W folderze `scripts` znajduje się skrypt, który automatycznie dodaje program do **Harmonogramu zadań systemu Windows** (Windows Task Scheduler), konfigurując go w najbardziej zoptymalizowany sposób (0% stałego obciążenia procesora/RAMu w tle):

1. Otwórz PowerShell jako administrator lub zwykły użytkownik.
2. Przejdź do folderu projektu:
   ```powershell
   cd "C:\sciezka\do\tui_price_checker"
   ```
3. Uruchom skrypt konfiguracji zadania z folderu `scripts`:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup_task.ps1
   ```

### Jak to działa?
*   Zadanie uruchomi się raz dziennie o godzinie **10:00** w tle.
*   Dzięki plikowi `scripts/run_hidden.vbs` program działa całkowicie **niewidocznie** (żadne okno konsoli CMD nie będzie wyskakiwać).
*   Jeśli Twój komputer był wyłączony o godzinie 10:00, Harmonogram zadań **uruchomi sprawdzanie automatycznie zaraz po włączeniu komputera**.

