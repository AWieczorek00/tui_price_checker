const { chromium } = require('playwright');
const notifier = require('node-notifier');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Wczytanie konfiguracji
const configPath = path.join(__dirname, '..', 'config', 'config.json');
let config = {
  hotels: [],
  email: {
    enabled: false,
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "twoj_email@gmail.com",
      pass: "twoje_haslo_aplikacji"
    },
    to: "odbiorca@gmail.com",
    sendOnPriceChangeOnly: false
  },
  enableDesktopNotifications: true,
  enableLogFile: true,
  logFilePath: "tui_prices.log"
};

if (fs.existsSync(configPath)) {
  try {
    const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migracja starej konfiguracji hotelUrl
    if (loadedConfig.hotelUrl && (!loadedConfig.hotels || loadedConfig.hotels.length === 0)) {
      config.hotels = [{
        name: "Domyślny hotel",
        url: loadedConfig.hotelUrl,
        priceLimitAlert: loadedConfig.priceLimitAlert || null
      }];
    } else {
      config.hotels = loadedConfig.hotels || [];
    }
    if (loadedConfig.email) {
      config.email = { ...config.email, ...loadedConfig.email };
    }
    config.enableDesktopNotifications = loadedConfig.enableDesktopNotifications !== undefined ? loadedConfig.enableDesktopNotifications : true;
    config.enableLogFile = loadedConfig.enableLogFile !== undefined ? loadedConfig.enableLogFile : true;
    config.logFilePath = loadedConfig.logFilePath || "tui_prices.log";
  } catch (err) {
    console.error('Błąd podczas wczytywania pliku config.json:', err.message);
  }
}

const logFile = path.join(__dirname, '..', config.logFilePath || 'tui_prices.log');

// Wczytanie stanu (ostatnie ceny dla poszczególnych hoteli)
const statePath = path.join(__dirname, '..', 'config', 'state.json');
let state = {
  lastPrices: {}
};

if (fs.existsSync(statePath)) {
  try {
    const loadedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (loadedState.lastPrices) {
      state.lastPrices = loadedState.lastPrices;
    } else if (loadedState.lastPrice !== undefined) {
      // Migracja starego formatu stanu
      const primaryUrl = config.hotels[0] ? config.hotels[0].url : "default";
      state.lastPrices = { [primaryUrl]: loadedState.lastPrice };
    }
  } catch (err) {
    console.error('Błąd podczas wczytywania pliku state.json:', err.message);
  }
}

// Tworzenie folderów pomocniczych
const screenshotsDir = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Funkcja pomocnicza do logowania
function log(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  if (config.enableLogFile) {
    fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
  }
}

// Funkcja pomocnicza do powiadomień systemowych
function sendNotification(title, message) {
  if (config.enableDesktopNotifications) {
    notifier.notify({
      title: title,
      message: message,
      sound: true,
      wait: true
    });
  }
}

// Generowanie bezpiecznej nazwy pliku
function getHotelSlug(hotelName) {
  return hotelName.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // usunięcie znaków diakrytycznych
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .replace(/[^\w\s-]/g, '') // usunięcie innych znaków specjalnych
    .trim()
    .replace(/[-\s_]+/g, '_'); // zastąpienie spacji/myślników podłogą
}

// Funkcja do wysyłania e-maila
async function sendEmailNotification(subject, htmlBody, screenshotPath, filename) {
  if (!config.email || !config.email.enabled) {
    return;
  }

  const { host, port, secure, auth, to } = config.email;
  if (!host || !auth || !auth.user || !auth.pass || !to) {
    log("Błąd e-mail: Konfiguracja SMTP jest niekompletna w config.json!");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      tls: {
        rejectUnauthorized: false
      }
    });

    const recipientString = Array.isArray(to) ? to.join(', ') : to;

    const dateSuffix = ` [${new Date().toLocaleString('pl-PL')}]`;
    const finalSubject = `${subject}${dateSuffix}`;

    const mailOptions = {
      from: config.email.from || auth.user,
      to: recipientString,
      subject: finalSubject,
      html: htmlBody,
      attachments: []
    };

    if (screenshotPath && fs.existsSync(screenshotPath)) {
      mailOptions.attachments.push({
        filename: filename || 'screenshot.png',
        path: screenshotPath,
        cid: 'screenshot' // ID używane wewnątrz HTML <img src="cid:screenshot" />
      });
    }

    log(`Wysyłanie e-maila do: ${recipientString}...`);
    const info = await transporter.sendMail(mailOptions);
    log(`E-mail wysłany pomyślnie! ID: ${info.messageId}`);
  } catch (error) {
    log(`Błąd podczas wysyłania e-maila: ${error.message}`);
  }
}

// Funkcja sprawdzająca pojedynczy hotel
async function checkHotel(browser, context, hotel) {
  if (!hotel.url) {
    log(`Błąd: Brak zdefiniowanego URL dla hotelu "${hotel.name}"!`);
    return;
  }

  log(`Sprawdzanie oferty: ${hotel.url}`);
  const page = await context.newPage();
  const slug = getHotelSlug(hotel.name || "hotel");
  const screenshotPath = path.join(screenshotsDir, `${slug}.png`);

  try {
    // Przejście na stronę
    await page.goto(hotel.url, { waitUntil: 'load', timeout: 60000 });
    log("Strona załadowana. Oczekiwanie na okno cookie...");

    // Czekamy chwilę na wyskoczenie okna cookie
    await page.waitForTimeout(3000);

    // Próba kliknięcia zgody na cookies
    const cookieSelectors = [
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button:has-text("Zezwól na wszystkie")',
      'button:has-text("Akceptuję")',
      'button:has-text("Akceptuj")',
      'button:has-text("Zgadzam się")',
      'button:has-text("Zaakceptuj wszystkie")',
      'button[id*="accept"]',
      'button[class*="accept"]'
    ];

    let cookieAccepted = false;
    for (const selector of cookieSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible()) {
          await btn.click();
          log(`Zaakceptowano cookies za pomocą selektora: "${selector}"`);
          cookieAccepted = true;
          break;
        }
      } catch (e) {
        // Ignorujemy błędy dla pojedynczych selektorów
      }
    }

    if (!cookieAccepted) {
      log("Nie znaleziono/nie kliknięto okna cookie. Kontynuowanie...");
    }

    // Dodatkowe czekanie na załadowanie cen/dostępności (TUI ładuje dane asynchronicznie)
    log("Oczekiwanie na załadowanie cen i dostępności oferty (10 sekund)...");
    await page.waitForTimeout(10000);

    // Pobranie całego kodu i tekstu strony w celu analizy
    const bodyText = await page.innerText('body');

    // Sprawdzenie, czy strona wyświetla przerwę techniczną (często z powodu bot detection)
    const maintenancePatterns = [
      /przepraszamy/i,
      /wysłaliśmy nasz serwis na krótkie wakacje/i,
      /wracamy niebawem/i
    ];

    let isMaintenance = false;
    for (const pattern of maintenancePatterns) {
      if (pattern.test(bodyText)) {
        log(`STATUS: Wykryto komunikat błędu/blokady bota na TUI dla hotelu "${hotel.name}" (wzorzec: "${pattern}")`);
        isMaintenance = true;
        break;
      }
    }

    if (isMaintenance) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      sendNotification(`TUI: Blokada / Przerwa - ${hotel.name}`, "Wykryto przerwę techniczną lub blokadę bota.");
      
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ffccbc; border-radius: 8px; padding: 20px; background-color: #fbe9e7;">
          <h2 style="color: #d84315; margin-top: 0;">Błąd monitora TUI: Wykryto blokadę lub przerwę techniczną</h2>
          <p>Podczas sprawdzania oferty hotelu <strong>${hotel.name}</strong> wykryto blokadę lub przerwę.</p>
          <p><strong>URL oferty:</strong> <a href="${hotel.url}">${hotel.url}</a></p>
          <hr style="border: 0; border-top: 1px solid #ffccbc; margin: 20px 0;">
          <p style="color: #555;">Zrzut ekranu błędu znajduje się w załączniku.</p>
          <div style="margin-top: 20px;">
            <img src="cid:screenshot" alt="Błąd TUI" style="width: 100%; border: 1px solid #ffab91; border-radius: 4px;" />
          </div>
        </div>
      `;
      await sendEmailNotification(`[TUI MONITOR] BŁĄD/BLOKADA - ${hotel.name}`, emailHtml, screenshotPath, `${slug}_error.png`);
      return;
    }

    // Definiowanie wzorców niedostępności (brak miejsc)
    const unavailablePatterns = [
      /brak wolnych miejsc/i,
      /brak ofert/i,
      /wyprzedane/i,
      /nie znaleziono ofert/i,
      /termin niedostępny/i,
      /brak dostępnych pokoi/i,
      /brak pokoi/i,
      /nie znaleźliśmy ofert/i
    ];

    let isUnavailable = false;
    for (const pattern of unavailablePatterns) {
      if (pattern.test(bodyText)) {
        log(`Wykryto brak dostępności dla hotelu "${hotel.name}" (wzorzec: ${pattern})`);
        isUnavailable = true;
        break;
      }
    }

    if (isUnavailable) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      sendNotification(`TUI: Brak Miejsc - ${hotel.name}`, "Brak wolnych miejsc na wybrany termin.");

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ffcc80; border-radius: 8px; padding: 20px; background-color: #fff8e1;">
          <h2 style="color: #ef6c00; margin-top: 0;">Brak wolnych miejsc w hotelu</h2>
          <p>Monitor wykrył, że hotel <strong>${hotel.name}</strong> nie ma wolnych miejsc w wybranym terminie.</p>
          <p><strong>URL oferty:</strong> <a href="${hotel.url}">${hotel.url}</a></p>
          <hr style="border: 0; border-top: 1px solid #ffcc80; margin: 20px 0;">
          <div style="margin-top: 20px;">
            <img src="cid:screenshot" alt="Brak miejsc" style="width: 100%; border: 1px solid #ffe082; border-radius: 4px;" />
          </div>
        </div>
      `;
      await sendEmailNotification(`[TUI MONITOR] BRAK MIEJSC - ${hotel.name}`, emailHtml, screenshotPath, `${slug}_brak_miejsc.png`);
      return;
    }

    // Pobieranie ceny z selektorów
    const priceSelectors = [
      '.price-value',
      '.offer-price',
      '.price',
      '.total-price',
      '[class*="price"]',
      '[class*="cena"]',
      'span:has-text("zł/os")',
      'span:has-text("zł")'
    ];

    let foundPriceText = null;
    let foundPriceVal = null;
    let perPersonPrice = null;
    let totalPrice = null;

    // Próba odnalezienia precyzyjnych fraz "Cena za osobę" i "Cena razem" w elementach
    try {
      const candidateElements = await page.locator('.price, .price-value, .total-price, [class*="price"]').all();
      for (const el of candidateElements) {
        try {
          const text = (await el.innerText()).trim().replace(/\s+/g, ' ');
          if (!text.includes('zł') && !text.includes('ZŁ') && !text.includes('PLN') && !text.includes('pln')) continue;

          const perPersonMatch = text.match(/cena\s+za\s+osobę:\s*([\d\s\u00a0]+)\s*(?:zł|PLN)/i);
          const totalMatch = text.match(/cena\s+razem:\s*([\d\s\u00a0]+)\s*(?:zł|PLN)/i);

          if (perPersonMatch) {
            const val = parseInt(perPersonMatch[1].replace(/[\s\u00a0]/g, ''), 10);
            if (!isNaN(val) && val > 100) {
              perPersonPrice = val;
            }
          }
          if (totalMatch) {
            const val = parseInt(totalMatch[1].replace(/[\s\u00a0]/g, ''), 10);
            if (!isNaN(val) && val > 100) {
              totalPrice = val;
            }
          }
        } catch (e) {
          // Pomijamy błędy odczytu pojedynczego elementu
        }
      }
    } catch (err) {
      log(`Błąd podczas wstępnego szukania cen: ${err.message}`);
    }

    // Jeśli znaleźliśmy precyzyjne ceny
    if (perPersonPrice || totalPrice) {
      if (perPersonPrice) {
        foundPriceVal = perPersonPrice;
        foundPriceText = `${perPersonPrice} zł/os.`;
        if (totalPrice) {
          foundPriceText += ` (${totalPrice} zł łącznie)`;
        }
        log(`Znaleziono ceny precyzyjne dla "${hotel.name}": ${foundPriceText}`);
      } else {
        foundPriceVal = totalPrice;
        foundPriceText = `${totalPrice} zł (cena łączna)`;
        log(`Znaleziono tylko cenę łączną dla "${hotel.name}": ${foundPriceText}`);
      }
    }

    // Jeśli precyzyjne dopasowanie nie powiodło się, stosujemy ogólne selektory
    if (!foundPriceVal) {
      for (const selector of priceSelectors) {
        try {
          const elements = page.locator(selector);
          const count = await elements.count();
          for (let i = 0; i < count; i++) {
            const text = await elements.nth(i).innerText();
            const match = text.match(/([\d\s\u00a0]+)\s*(?:zł|PLN)/i);
            if (match) {
              const priceStr = match[1].replace(/[\s\u00a0]/g, '');
              const priceVal = parseInt(priceStr, 10);
              if (!isNaN(priceVal) && priceVal > 100) {
                foundPriceText = text.trim().replace(/\s+/g, ' ');
                foundPriceVal = priceVal;
                log(`Znaleziono cenę hotelu "${hotel.name}" przez ogólny selektor "${selector}": ${foundPriceText} (${foundPriceVal} zł)`);
                break;
              }
            }
          }
          if (foundPriceVal) break;
        } catch (e) {
          // Ignorujemy błędy dla pojedynczych selektorów
        }
      }
    }

    // Próba wyszukania ceny w całym tekście strony
    if (!foundPriceVal) {
      log(`Selektory zawiodły dla "${hotel.name}". Przeszukiwanie całego tekstu strony...`);
      const regexPatterns = [
        /([\d\s\u00a0]+)\s*zł\/os/gi,
        /od\s*([\d\s\u00a0]+)\s*zł/gi,
        /([\d\s\u00a0]+)\s*zł/gi
      ];

      for (const regex of regexPatterns) {
        const matches = [...bodyText.matchAll(regex)];
        for (const match of matches) {
          const priceStr = match[1].replace(/[\s\u00a0]/g, '');
          const priceVal = parseInt(priceStr, 10);
          if (!isNaN(priceVal) && priceVal > 300 && priceVal < 100000) {
            foundPriceVal = priceVal;
            foundPriceText = match[0].trim();
            log(`Znaleziono cenę hotelu "${hotel.name}" w tekście strony przez regex: ${foundPriceText} (${priceVal} zł)`);
            break;
          }
        }
        if (foundPriceVal) break;
      }
    }

    if (foundPriceVal) {
      const msg = `Aktualna cena dla "${hotel.name}": ${foundPriceText} (${foundPriceVal} zł).`;
      log(`STATUS: OK - ${msg}`);

      // Sprawdzenie progu ceny dla wykonania zrzutu ekranu
      const hasThreshold = hotel.priceLimitAlert !== null && hotel.priceLimitAlert !== undefined;
      const isBelowThreshold = hasThreshold && foundPriceVal <= hotel.priceLimitAlert;
      let hasScreenshot = false;

      if (isBelowThreshold) {
        log(`Cena (${foundPriceVal} zł) jest równa lub niższa od progu alarmowego (${hotel.priceLimitAlert} zł) dla "${hotel.name}". Wykonywanie zrzutu ekranu...`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        hasScreenshot = true;
      } else {
        const diffAboveLimitMsg = hasThreshold 
          ? ` (o ${foundPriceVal - hotel.priceLimitAlert} zł drożej niż próg zakupu)` 
          : '';
        log(`Cena (${foundPriceVal} zł) jest powyżej progu alarmowego (${hotel.priceLimitAlert || 'brak'} zł) dla "${hotel.name}"${diffAboveLimitMsg}. Zrzut ekranu nie został wykonany.`);
        // Usunięcie ewentualnego starego zrzutu ekranu, aby zapobiec wysyłce nieaktualnych plików
        if (fs.existsSync(screenshotPath)) {
          try {
            fs.unlinkSync(screenshotPath);
          } catch (e) {}
        }
      }

      // Sprawdzenie historii cen
      const lastPrice = state.lastPrices[hotel.url];
      let priceChangeMsg = "";
      let isChanged = false;
      let emailSubject = `[TUI MONITOR] Wynik sprawdzenia - ${hotel.name}`;
      let priceColor = "#333333";
      let priceDropInfoHtml = "";

      if (lastPrice !== undefined && lastPrice !== null) {
        if (foundPriceVal < lastPrice) {
          const diff = lastPrice - foundPriceVal;
          priceChangeMsg = `Cena spadła o ${diff} zł! (Poprzednio: ${lastPrice} zł, Teraz: ${foundPriceVal} zł).`;
          isChanged = true;
          priceColor = "#2e7d32";
          emailSubject = `[TUI MONITOR] CENA SPADŁA! 🎉 - ${hotel.name}`;
          log(`SPADEK CENY: ${priceChangeMsg}`);
          sendNotification(`TUI: CENA SPADŁA! 🎉 - ${hotel.name}`, priceChangeMsg);
        } else if (foundPriceVal > lastPrice) {
          const diff = foundPriceVal - lastPrice;
          priceChangeMsg = `Cena wzrosła o ${diff} zł. (Poprzednio: ${lastPrice} zł, Teraz: ${foundPriceVal} zł).`;
          isChanged = true;
          priceColor = "#c62828";
          emailSubject = `[TUI MONITOR] Cena wzrosła - ${hotel.name}`;
          log(`WZROST CENY: ${priceChangeMsg}`);
          sendNotification(`TUI: Cena wzrosła - ${hotel.name}`, priceChangeMsg);
        } else {
          priceChangeMsg = `Cena bez zmian (${foundPriceVal} zł).`;
          log(`BEZ ZMIAN: ${priceChangeMsg}`);
        }
      } else {
        priceChangeMsg = `Pierwszy odczyt ceny: ${foundPriceVal} zł.`;
        isChanged = true;
        emailSubject = `[TUI MONITOR] Pierwszy odczyt - ${hotel.name}`;
        log(`PIERWSZY ODCZYT: ${priceChangeMsg}`);
        sendNotification(`TUI: Pierwszy odczyt - ${hotel.name}`, priceChangeMsg);
      }

      // Przygotowanie informacji o obniżce ceny (względem ceny progowej/zakupu lub poprzedniej ceny jako fallback)
      const hasLimit = hotel.priceLimitAlert !== null && hotel.priceLimitAlert !== undefined;
      if (hasLimit) {
        if (foundPriceVal < hotel.priceLimitAlert) {
          const diffToLimit = hotel.priceLimitAlert - foundPriceVal;
          priceDropInfoHtml = `
            <div style="margin: 15px 0; padding: 12px; background-color: #e8f5e9; border-left: 4px solid #2e7d32; border-radius: 4px;">
              <span style="font-size: 16px; color: #2e7d32; font-weight: bold;">
                Cena spadła o: <span style="font-size: 20px;">-${diffToLimit} zł</span>!
              </span>
              <br/>
              <span style="font-size: 13px; color: #4caf50;">Względem ceny progowej (zakupu): ${hotel.priceLimitAlert} zł &rarr; Nowa cena: ${foundPriceVal} zł</span>
            </div>
          `;
        }
      } else if (lastPrice !== undefined && lastPrice !== null && foundPriceVal < lastPrice) {
        const diff = lastPrice - foundPriceVal;
        priceDropInfoHtml = `
          <div style="margin: 15px 0; padding: 12px; background-color: #e8f5e9; border-left: 4px solid #2e7d32; border-radius: 4px;">
            <span style="font-size: 16px; color: #2e7d32; font-weight: bold;">
              Cena spadła o: <span style="font-size: 20px;">-${diff} zł</span>!
            </span>
            <br/>
            <span style="font-size: 13px; color: #4caf50;">Względem poprzedniej ceny: ${lastPrice} zł &rarr; Nowa cena: ${foundPriceVal} zł</span>
          </div>
        `;
      }

      // Sprawdzenie limitu ceny (alert dodatkowy)
      if (hotel.priceLimitAlert && foundPriceVal <= hotel.priceLimitAlert) {
        sendNotification(
          `TUI: LIMIT PRZEKROCZONY! - ${hotel.name}`,
          `Cena jest poniżej limitu ${hotel.priceLimitAlert} zł! Aktualna cena: ${foundPriceVal} zł.`
        );
        emailSubject = `[TUI MONITOR] LIMIT OKAZJI PRZEKROCZONY! ⚡ - ${hotel.name}`;
      } else if (hotel.priceLimitAlert && foundPriceVal > hotel.priceLimitAlert) {
        const diffAboveLimit = foundPriceVal - hotel.priceLimitAlert;
        log(`CENA POWYŻEJ PROGU: Hotel "${hotel.name}" podrożał o ${diffAboveLimit} zł w stosunku do ceny progowej (zakupu: ${hotel.priceLimitAlert} zł).`);
      }

      // Czy wysłać e-mail?
      let shouldSendEmail = !config.email.sendOnPriceChangeOnly || isChanged || (hotel.priceLimitAlert && foundPriceVal <= hotel.priceLimitAlert);

      // Blokada wysyłki, jeśli cena z dnia poprzedniego jest taka sama jak dziś
      if (lastPrice !== undefined && lastPrice !== null && foundPriceVal === lastPrice) {
        shouldSendEmail = false;
        log(`Wstrzymano wysłanie e-maila: dzisiejsza cena (${foundPriceVal} zł) jest taka sama jak w poprzednim odczycie.`);
      }

      if (shouldSendEmail) {
        const screenshotSection = hasScreenshot
          ? `
            <div style="margin-top: 25px;">
              <p style="font-size: 14px; color: #666666; margin-bottom: 10px;">Zrzut ekranu oferty (cena poniżej progu):</p>
              <img src="cid:screenshot" alt="Screenshot oferty" style="width: 100%; border: 1px solid #dddddd; border-radius: 4px; display: block;" />
            </div>
          `
          : `
            <div style="margin-top: 25px; padding: 15px; background-color: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px; text-align: center; color: #666666; font-size: 14px;">
              Zrzut ekranu nie został załączony (cena ${foundPriceVal} zł jest powyżej progu alarmowego ${hotel.priceLimitAlert || 'brak'} zł).
            </div>
          `;

        const emailHtml = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff; color: #333333;">
            <div style="text-align: center; border-bottom: 2px solid #00509d; padding-bottom: 15px; margin-bottom: 20px;">
              <h2 style="color: #00509d; margin: 0;">TUI Price Monitor</h2>
            </div>
            
            <div style="margin-bottom: 20px; line-height: 1.6;">
              <p style="font-size: 16px; margin: 5px 0;"><strong>Hotel:</strong> <a href="${hotel.url}" style="color: #00509d; text-decoration: none;">${hotel.name}</a></p>
              <p style="font-size: 16px; margin: 5px 0;"><strong>Aktualna cena:</strong> <span style="font-size: 18px; color: ${priceColor}; font-weight: bold;">${foundPriceVal} zł</span></p>
              <p style="font-size: 16px; margin: 5px 0; color: #555555;"><strong>Status:</strong> ${priceChangeMsg}</p>
              ${priceDropInfoHtml}
              ${hotel.priceLimitAlert ? `<p style="font-size: 15px; margin: 5px 0; color: #d84315;"><strong>Zdefiniowany próg:</strong> ${hotel.priceLimitAlert} zł</p>` : ''}
            </div>

            ${screenshotSection}

            <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #eeeeee; text-align: center; font-size: 12px; color: #999999;">
              Wiadomość wygenerowana automatycznie przez TUI Price Checker.
            </div>
          </div>
        `;
        await sendEmailNotification(emailSubject, emailHtml, hasScreenshot ? screenshotPath : null, `${slug}.png`);
      }

      // Aktualizacja stanu
      state.lastPrices[hotel.url] = foundPriceVal;
      try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
      } catch (err) {
        log(`Błąd zapisu state.json: ${err.message}`);
      }

    } else {
      // Jeśli nie udało się odczytać ceny
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Błąd: Nie udało się odczytać ceny hotelu "${hotel.name}". Zapisano zrzut ekranu w ${screenshotPath}`);
      sendNotification(`TUI Checker: Błąd - ${hotel.name}`, "Nie udało się pobrać ceny.");

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ffccbc; border-radius: 8px; padding: 20px; background-color: #fbe9e7;">
          <h2 style="color: #d84315; margin-top: 0;">Błąd monitora TUI: Nie udało się odczytać ceny</h2>
          <p>Podczas sprawdzania oferty hotelu <strong>${hotel.name}</strong> nie udało się pobrać aktualnej ceny ani wykryć braku miejsc.</p>
          <p><strong>URL oferty:</strong> <a href="${hotel.url}">${hotel.url}</a></p>
          <hr style="border: 0; border-top: 1px solid #ffccbc; margin: 20px 0;">
          <p style="color: #555;">Zrzut ekranu z próby wejścia na stronę znajduje się w załączniku.</p>
          <div style="margin-top: 20px;">
            <img src="cid:screenshot" alt="Błąd TUI" style="width: 100%; border: 1px solid #ffab91; border-radius: 4px;" />
          </div>
        </div>
      `;
      await sendEmailNotification(`[TUI MONITOR] BŁĄD ODCZYTU - ${hotel.name}`, emailHtml, screenshotPath, `${slug}_error.png`);
    }

  } catch (error) {
    log(`Wyjątek podczas scrapowania hotelu "${hotel.name}": ${error.message}`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Zapisano zrzut ekranu błędu w ${screenshotPath}`);
    } catch (e) {}

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ffccbc; border-radius: 8px; padding: 20px; background-color: #fbe9e7;">
        <h2 style="color: #d84315; margin-top: 0;">Wyjątek monitora TUI</h2>
        <p>Wystąpił nieoczekiwany błąd podczas sprawdzania hotelu <strong>${hotel.name}</strong>.</p>
        <p><strong>Treść błędu:</strong> <code style="background: #ffccbc; padding: 2px 4px; border-radius: 4px;">${error.message}</code></p>
        <p><strong>URL oferty:</strong> <a href="${hotel.url}">${hotel.url}</a></p>
        <hr style="border: 0; border-top: 1px solid #ffccbc; margin: 20px 0;">
        <div style="margin-top: 20px;">
          <img src="cid:screenshot" alt="Wyjątek TUI" style="width: 100%; border: 1px solid #ffab91; border-radius: 4px;" />
        </div>
      </div>
    `;
    await sendEmailNotification(`[TUI MONITOR] WYJĄTEK - ${hotel.name}`, emailHtml, screenshotPath, `${slug}_exception.png`);
    sendNotification(`TUI Checker: Wyjątek - ${hotel.name}`, `Błąd: ${error.message}`);
  } finally {
    await page.close();
  }
}

// Uruchomienie głównego procesu
async function run() {
  if (!config.hotels || config.hotels.length === 0) {
    log("Błąd: Brak hoteli w konfiguracji!");
    sendNotification("TUI Checker: Błąd", "Brak hoteli w konfiguracji.");
    return;
  }

  log(`Rozpoczęto monitorowanie hoteli (liczba: ${config.hotels.length})`);
  
  const browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
    viewport: { width: 1280, height: 900 },
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    extraHTTPHeaders: {
      'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  for (let i = 0; i < config.hotels.length; i++) {
    const hotel = config.hotels[i];
    log(`[Hotel ${i + 1}/${config.hotels.length}] ${hotel.name}`);
    await checkHotel(browser, context, hotel);
    
    if (i < config.hotels.length - 1) {
      log("Oczekiwanie 5 sekund przed kolejnym hotelem...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  await browser.close();
  log("Zakończono monitorowanie wszystkich hoteli.");
}

// Wywołanie głównej funkcji
run();
