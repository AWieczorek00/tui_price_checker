$taskName = "TuiPriceChecker"
$scriptPath = Join-Path $PSScriptRoot "run_hidden.vbs"


# Zdefiniowanie akcji: Uruchomienie wscript.exe ze sciezka do run_hidden.vbs
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$scriptPath`""

# Zdefiniowanie wyzwalacza: Codziennie o godzinie 10:00 rano
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00AM

# Ustawienia zadania:
# - StartWhenAvailable: Uruchamia zadanie przy najblizszej okazji, jesli zaplanowany termin minal (np. komputer byl wylaczony o 10:00)
# - AllowStartIfOnBatteries: Zezwala na uruchomienie na baterii
# - DontStopIfGoingOnBatteries: Zapobiega wylaczeniu przy przejsciu na zasilanie bateryjne
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Write-Host "Rejestrowanie zadania w Harmonogramie zadan Windows..."
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Automatyczne codzienne sprawdzanie cen hotelu na TUI.pl w tle." -Force
Write-Host "Zadanie '$taskName' zostalo pomyslnie zarejestrowane!"
Write-Host "Zadanie bedzie uruchamiac sie codziennie o 10:00 rano (lub zaraz po wlaczeniu komputera, jesli byl wylaczony)."
