const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Ustawienie ścieżki do konfiguracji relative do folderu scripts
const configPath = path.join(__dirname, '..', 'config', 'config.json');

console.log('--- TEST POWIADOMIEŃ E-MAIL ---');
console.log(`Wczytywanie konfiguracji z: ${configPath}`);

if (!fs.existsSync(configPath)) {
  console.error('Błąd: Nie odnaleziono pliku config.json! Upewnij się, że ścieżka jest prawidłowa.');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`Błąd wczytywania JSON: ${err.message}`);
  process.exit(1);
}

if (!config.email) {
  console.error('Błąd: Brak sekcji "email" w pliku config.json!');
  process.exit(1);
}

const { enabled, host, port, secure, auth, to } = config.email;

console.log('\nAktualna konfiguracja e-mail:');
console.log(`- Włączone: ${enabled}`);
console.log(`- Serwer SMTP: ${host}`);
console.log(`- Port: ${port}`);
console.log(`- SSL/TLS (secure): ${secure}`);
console.log(`- Użytkownik: ${auth ? auth.user : 'brak'}`);
console.log(`- Hasło: ${auth && auth.pass ? '*** (skonfigurowane)' : 'brak'}`);
const recipientString = Array.isArray(to) ? to.join(', ') : to;
console.log(`- Odbiorca: ${recipientString}`);

if (!host || !auth || !auth.user || !auth.pass || !to) {
  console.log('\n[UWAGA] Konfiguracja e-mail jest niekompletna. Proszę uzupełnić dane w config.json przed uruchomieniem testu.');
  process.exit(0);
}

async function runTest() {
  console.log('\nInicjowanie połączenia SMTP...');
  
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    // 1. Weryfikacja połączenia SMTP
    await transporter.verify();
    console.log('✔ Połączenie z serwerem SMTP powiodło się!');

    // 2. Przygotowanie testowego załącznika (istniejący tui_error.png lub pusty plik testowy)
    let testAttachmentPath = path.join(__dirname, '..', 'tui_error.png');
    let hasAttachment = false;

    if (fs.existsSync(testAttachmentPath)) {
      hasAttachment = true;
      console.log(`Znaleziono obrazek testowy: ${testAttachmentPath}`);
    } else {
      testAttachmentPath = path.join(__dirname, 'temp_test.png');
      fs.writeFileSync(testAttachmentPath, 'Test data for screenshot', 'utf8');
      hasAttachment = true;
      console.log('Utworzono tymczasowy plik załącznika.');
    }

    // 3. Wysłanie testowego maila
    console.log('Wysyłanie próbnego e-maila z załącznikiem...');
    
    const mailOptions = {
      from: config.email.from || auth.user,
      to: recipientString,
      subject: '[TUI Price Checker] Test Powiadomień E-mail 🚀',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
          <h2 style="color: #00509d; border-bottom: 2px solid #00509d; padding-bottom: 10px;">Test działania e-maili</h2>
          <p>Gratulacje! Twoja konfiguracja serwera SMTP działa poprawnie.</p>
          <p>Poniżej powinieneś zobaczyć osadzony obrazek testowy:</p>
          <div style="margin-top: 20px;">
            <img src="cid:screenshot" alt="Testowy zrzut ekranu" style="width: 100%; max-width: 400px; border: 1px solid #ddd; border-radius: 4px;" />
          </div>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">TUI Price Checker test mail.</p>
        </div>
      `,
      attachments: []
    };

    if (hasAttachment) {
      mailOptions.attachments.push({
        filename: 'test_screenshot.png',
        path: testAttachmentPath,
        cid: 'screenshot'
      });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`✔ E-mail został pomyślnie wysłany!`);
    console.log(`- ID wiadomości: ${info.messageId}`);
    console.log(`- Odbiorca: ${info.accepted.join(', ')}`);

    // Czyszczenie pliku tymczasowego jeśli go utworzyliśmy
    if (testAttachmentPath === path.join(__dirname, 'temp_test.png') && fs.existsSync(testAttachmentPath)) {
      fs.unlinkSync(testAttachmentPath);
    }

  } catch (error) {
    console.error('\n❌ BŁĄD WYSYŁANIA E-MAILA:');
    console.error(error);
  }
}

runTest();
