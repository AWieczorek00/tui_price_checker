$taskName = "TuiPriceChecker"
$scriptPath = Join-Path $PSScriptRoot "run_hidden.vbs"


# Zdefiniowanie akcji: Uruchomienie wscript.exe ze ścieżką do run_hidden.vbs
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$scriptPath`""

# Zdefiniowanie wyzwalacza: Codziennie o godzinie 10:00 rano
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00AM

# Ustawienia zadania:
# - StartWhenAvailable: Uruchamia zadanie przy najbliższej okazji, jeśli zaplanowany termin minął (np. komputer był wyłączony o 10:00)
# - AllowStartIfOnBatteries: Zezwala na uruchomienie na baterii
# - DontStopIfGoingOnBatteries: Zapobiega wyłączeniu przy przejściu na zasilanie bateryjne
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Write-Host "Rejestrowanie zadania w Harmonogramie zadań Windows..."
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Automatyczne codzienne sprawdzanie cen hotelu na TUI.pl w tle." -Force
Write-Host "Zadanie '$taskName' zostało pomyślnie zarejestrowane!"
Write-Host "Zadanie będzie uruchamiać się codziennie o 10:00 rano (lub zaraz po włączeniu komputera, jeśli był wyłączony)."
