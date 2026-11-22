// Źródło Telegram: parsowanie publicznego podglądu t.me/s/<kanał> na danych syntetycznych (bez sieci).
// Struktura HTML odpowiada prawdziwej stronie podglądu (klasy tgme_*, data-post, time[datetime], data-before).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelegramHandle, parseTelegramPage } from '../src/sources/telegram.ts';

const msg = (id: number, text: string, at: string, author?: string) => `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message js-widget_message" data-post="cj_wymiana/${id}">
    <div class="tgme_widget_message_bubble">
      ${author ? `<span class="tgme_widget_message_from_author">${author}</span>` : ''}
      <div class="tgme_widget_message_text js-message_text">${text}</div>
      <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/cj_wymiana/${id}"><time datetime="${at}" class="time">12:00</time></a></div>
    </div>
  </div>
</div>`;

const CHANNEL = `<!DOCTYPE html><html><head><meta property="og:title" content="CJ wymiana"></head><body>
<div class="tgme_channel_info">
  <div class="tgme_channel_info_header">
    <div class="tgme_channel_info_header_title"><span dir="auto">CJ wymiana</span></div>
    <div class="tgme_channel_info_header_labels"><i class="verified-icon"> ✔</i></div>
  </div>
  <div class="tgme_channel_info_description">Wymiana P2P. Kontakt: janek@example.com</div>
</div>
<div class="tme_messages_more js-messages_more" data-before="101"></div>
${msg(101, 'Rozliczenie za zamówienie – wpłata USDT (TRC20):<br>TQ7nVhLv7J6nLm3WcWqP4xS2b8m9Kd3Wd9', '2026-11-20T10:00:00+00:00')}
${msg(102, 'Dzień dobry, dziś bez ofert.', '2026-11-20T11:00:00+00:00', 'Janek')}
</body></html>`;

test('Telegram: podgląd kanału – nagłówek, weryfikacja, wiadomości z permalinkiem i datą, stronicowanie', () => {
  const p = parseTelegramPage(CHANNEL);
  assert.equal(p.isChannel, true);
  assert.equal(p.title, 'CJ wymiana');
  assert.equal(p.verified, true);
  assert.match(p.description, /janek@example\.com/);
  assert.equal(p.before, 101);
  assert.equal(p.messages.length, 2);
  const [a, b] = p.messages;
  assert.equal(a.url, 'https://t.me/cj_wymiana/101');
  assert.equal(a.publishedAt, '2026-11-20T10:00:00+00:00');
  assert.match(a.text, /TQ7nVhLv7J6nLm3WcWqP4xS2b8m9Kd3Wd9/);
  assert.match(a.text, /\n/, 'znacznik <br> zamieniony na nową linię');
  assert.equal(a.author, undefined, 'wiadomość wysłana jako kanał');
  assert.equal(b.author, 'Janek', 'podpis autora wiadomości');
});

test('Telegram: strona bez podglądu (prywatne konto / brak kanału) nie jest traktowana jako kanał', () => {
  const p = parseTelegramPage('<html><head><title>Telegram: Contact @someone</title></head><body><div class="tgme_page"></div></body></html>');
  assert.equal(p.isChannel, false);
  assert.equal(p.messages.length, 0);
});

test('Telegram: normalizacja nazwy kanału z różnych zapisów', () => {
  assert.equal(normalizeTelegramHandle('@cj_wymiana'), 'cj_wymiana');
  assert.equal(normalizeTelegramHandle('https://t.me/s/cj_wymiana/12'), 'cj_wymiana');
  assert.equal(normalizeTelegramHandle('https://telegram.me/cj_wymiana'), 'cj_wymiana');
  assert.equal(normalizeTelegramHandle('https://t.me/joinchat'), null, 'ścieżki systemowe Telegrama to nie kanały');
  assert.equal(normalizeTelegramHandle('abc'), null, 'za krótka nazwa');
  assert.equal(normalizeTelegramHandle('1abcde'), null, 'nazwa musi zaczynać się od litery');
});
