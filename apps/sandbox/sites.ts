// FIKCYJNE strony do scenariuszy testowych OGAR. Osoby, nicki, e-maile (domena example.com –
// zarezerwowana RFC 2606) i adresy są syntetyczne. Adresy kryptowalut są poprawne formalnie,
// ale wygenerowane z sha256 – nikt nie posiada do nich kluczy.
// Okres 1 / okres 2 symuluje upływ czasu (np. podmianę adresu w profilu) – patrz /__admin.

export interface Page {
  path: string;
  title: string;
  render: (period: number, base: string) => string;
}

const A = {
  tipjar: 'bc1qpgfd4zxrrenlgyxvvlvrqy84a8f2h408fmfakp',
  olaTrx: 'TUif3irKWRKLhzUw6yxyJNXayRqAncnCT9',
  olaEth: '0xa88e193AF8F2bF13beaD0515f635371FF4A3357d',
  marekV1: 'bc1ql8ur7j730hwtyn3jfwxcvwwwyqttksaln6tal8',
  marekV2: 'bc1q3nvmyp6hwzzyyjda3w0dvvvqp8h4vcku6huhnw',
  p2p: '0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A',
  forum: '0x7B431cddF8855cAd9946aB62557E5EE893b92D83',
  forumTypo: '0x7B431cddF8855cAd9946aB62557E5EE893b92D84',
  giveaway: '0x18b30Ed55876d989a6Ff02c60ad187f3cda07994',
  tron: 'TXLFKvqCJRzYQHsHMYNgtqHVq6VdNqgkSq',
  anonek: '0xeCd180Ba67478bE746F54732bE67fa8719691e6B',
  binanceEth: '0x28C6c06298d514Db089934071355E5743bf21d60',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  nowakGiveaway: '0x149bCE5c4470a7dd2B62727b8B52d62652b4da60',
  nowakForum: 'bc1qfzspkgc3zjlltz2nd32xudvrg38ytx58w9z59w',
  binanceBtc: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
  charityBtc: '357a3So9CbsNfBBgFYACGvxxS6tMaDoa1P',
};

const shell = (site: string, title: string, body: string, extraHead = '') => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title>${extraHead}
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#222}.site{background:#eef;padding:6px 10px;border-radius:6px;font-size:12px}
.post{border:1px solid #ddd;border-radius:6px;padding:8px 10px;margin:8px 0}.who{font-weight:600}.when{color:#888;font-size:12px}code{background:#f4f4f4;padding:1px 4px}</style></head>
<body><div class="site">🧪 PIASKOWNICA TESTOWA · ${site} · dane fikcyjne</div>${body}</body></html>`;

export const PAGES: Page[] = [
  {
    path: '/s/kodhub.example/cryptojanek',
    title: 'cryptojanek – KodHub',
    render: (_p, base) =>
      shell(
        'kodhub.example (serwis dla programistów)',
        'cryptojanek – KodHub',
        `<main data-doc data-kind="profile" data-author="cryptojanek" data-verified="true" data-published="2024-05-10T08:00:00Z">
<h1>cryptojanek <small>(Jan Testowy)</small> ✔</h1>
<p>Python / Solidity developer z Bydgoszczy. Buduję boty do arbitrażu.</p>
<p>☕ Tip jar BTC: <code>${A.tipjar}</code></p>
<p>WWW: <a href="${base}/s/janek-testowy.example/">${base}/s/janek-testowy.example/</a><br>Kontakt: jan.testowy@example.com</p>
<h3>Repozytoria</h3><ul><li>arb-bot-eth – bot do arbitrażu DEX</li><li>p2p-escrow-notes</li></ul></main>`,
      ),
  },
  {
    path: '/s/janek-testowy.example/',
    title: 'Jan Testowy – strona osobista',
    render: () =>
      shell(
        'janek-testowy.example (strona osobista)',
        'Jan Testowy – strona osobista',
        `<main data-doc data-kind="website" data-author="cryptojanek">
<h1>Jan Testowy</h1><p>Programista, entuzjasta DeFi. Prowadzę drobny handel P2P stablecoinami.</p>
<p>Wspieraj moje projekty open-source – darowizny BTC: <code>${A.tipjar}</code></p>
<p>Szybki kontakt w sprawie wymiany: Telegram <a href="https://t.me/janek_p2p">t.me/janek_p2p</a></p>
<footer>© cryptojanek · jan.testowy@example.com</footer></main>`,
      ),
  },
  {
    path: '/s/forum-krypto.example/watek/1287',
    title: 'Forum Krypto – Jaki portfel ETH polecacie?',
    render: () =>
      shell(
        'forum-krypto.example (forum branżowe)',
        'Forum Krypto – Jaki portfel ETH polecacie?',
        `<main data-doc data-kind="post"><h1>Jaki portfel ETH polecacie?</h1>
<div class="post" data-segment data-kind="post" data-author="anonek" data-published="2026-02-02T10:00:00Z"><span class="who">anonek</span> <span class="when">2026-02-02</span><p>Ja trzymam wszystko na ${A.anonek} (Ledger), polecam sprzętowy.</p></div>
<div class="post" data-segment data-kind="post" data-author="cryptojanek" data-published="2026-02-02T11:15:00Z"><span class="who">cryptojanek</span> <span class="when">2026-02-02</span><p>Ja używam MetaMaska, mój adres do testów ${A.forum} – możecie podejrzeć historię, nic tam ciekawego 😉</p></div>
<div class="post" data-segment data-kind="post" data-author="kolekcjoner77" data-published="2026-02-02T12:30:00Z"><span class="who">kolekcjoner77</span><p>@cryptojanek chyba literówka, wkleiłeś ${A.forumTypo}? Uwaga też na fałszywe tokeny – prawdziwy kontrakt USDT to ${A.usdt}</p></div>
<div class="post" data-segment data-kind="post" data-author="cryptojanek" data-published="2026-02-03T09:05:00Z"><span class="who">cryptojanek</span><p>Wypłaty robię zawsze przez Binance, wysyłam na ${A.binanceEth} i potem na konto w PLN.</p></div>
</main>`,
      ),
  },
  {
    path: '/s/p2p-rynek.example/oferta/5521',
    title: 'Sprzedam USDT za PLN – P2P Rynek',
    render: () =>
      shell(
        'p2p-rynek.example (ogłoszenia P2P)',
        'Sprzedam USDT za PLN – P2P Rynek',
        `<main data-doc data-kind="listing" data-author="cryptojanek" data-published="2026-03-01T09:00:00Z">
<h1>Sprzedam 3000 USDT (ERC-20) za PLN</h1>
<p>Kurs 4,02 PLN. Płatność przelewem na konto, po zaksięgowaniu wysyłam z portfela <code>${A.p2p}</code>.</p>
<p>Akceptuję też zapłatę w BTC: <code>${A.tipjar}</code></p>
<p>Sprzedawca: <b>cryptojanek</b> · kontakt Telegram: t.me/janek_p2p</p></main>`,
      ),
  },
  {
    path: '/s/telegram-podglad.example/janek_p2p',
    title: 'Kanał @janek_p2p – podgląd publiczny',
    render: () =>
      shell(
        'telegram-podglad.example (publiczny podgląd kanału komunikatora)',
        'Kanał @janek_p2p',
        `<main data-doc data-kind="channel" data-author="janek_p2p"><h1>@janek_p2p – Wymiana P2P USDT ⇄ PLN</h1>
<div class="post" data-segment data-kind="channel" data-author="janek_p2p" data-published="2026-03-20T18:00:00Z"><p>Rozliczenie dla kupujących USDT na TRON: przelej na TRC-20 <code>${A.tron}</code>, po zaksięgowaniu wysyłam PLN na konto.</p></div>
<div class="post" data-segment data-kind="channel" data-author="janek_p2p" data-published="2026-03-22T08:00:00Z"><p>Dziś kurs sprzedaży 4,01. Pisać na priv.</p></div></main>`,
      ),
  },
  {
    path: '/s/insta-fake.example/post/9',
    title: 'GIVEAWAY 1 ETH – kryptoguru_official',
    render: () =>
      shell(
        'insta-fake.example (serwis społecznościowy)',
        'GIVEAWAY 1 ETH – kryptoguru_official',
        `<main data-doc data-kind="post" data-author="kryptoguru_official"><h1>🎁 GIVEAWAY 1 ETH! Zostaw adres w komentarzu i oznacz 3 znajomych</h1>
<div class="post" data-segment data-kind="comment" data-author="cryptojanek"><span class="who">cryptojanek</span><p>giveaway 🙏 ${A.giveaway}</p></div>
<div class="post" data-segment data-kind="comment" data-author="nowak_btc"><span class="who">nowak_btc</span><p>konkurs! ${A.nowakGiveaway} @a @b @c</p></div>
<div class="post" data-segment data-kind="comment" data-author="ola_k"><span class="who">ola_k</span><p>może tym razem 🤞</p></div></main>`,
      ),
  },
  {
    path: '/s/lista-mailingowa.example/archiwum/2026-03/0042',
    title: 'Re: [defi-pl] Spotkanie w Bydgoszczy',
    render: () =>
      shell(
        'lista-mailingowa.example (publiczne archiwum listy dyskusyjnej)',
        'Re: [defi-pl] Spotkanie w Bydgoszczy',
        `<main data-doc data-kind="email" data-author="jan.testowy@example.com" data-published="2026-03-12T19:40:00Z"><h1>Re: [defi-pl] Spotkanie w Bydgoszczy</h1>
<p><b>Od:</b> jan.testowy@example.com</p>
<div data-segment data-kind="email" data-author="jan.testowy@example.com"><p>Będę na spotkaniu, mogę opowiedzieć o arbitrażu na DEX-ach.</p></div>
<div data-segment data-kind="email" data-author="jan.testowy@example.com" data-hint="signature"><pre>--
Jan Testowy
BTC: ${A.tipjar}</pre></div></main>`,
      ),
  },
  {
    path: '/s/forum-krypto.example/watek/3001',
    title: 'Forum Krypto – Ostrzeżenie: oszustwo na P2P',
    render: () =>
      shell(
        'forum-krypto.example (forum branżowe)',
        'Forum Krypto – Ostrzeżenie: oszustwo na P2P',
        `<main data-doc data-kind="post"><h1>Ostrzeżenie: oszustwo na P2P?</h1>
<div class="post" data-segment data-kind="post" data-author="czujny_user" data-published="2026-03-10T08:00:00Z"><span class="who">czujny_user</span><p>Uwaga, scam! Nie wysyłajcie nic na ${A.olaTrx} – kupująca nie przelała mi PLN, a USDT poszły.</p></div>
</main>`,
      ),
  },
  // Scenariusz 3 – ola_wymiana: wejściem jest jej adres TRON, osobę trzeba dopiero ustalić.
  {
    path: '/s/p2p-rynek.example/oferta/7730',
    title: 'Kupię USDT (TRC-20) za PLN – P2P Rynek',
    render: () =>
      shell(
        'p2p-rynek.example (ogłoszenia P2P)',
        'Kupię USDT (TRC-20) za PLN – P2P Rynek',
        `<main data-doc data-kind="listing" data-author="ola_wymiana" data-published="2026-04-15T12:00:00Z">
<h1>Kupię USDT (TRC-20) – każdą ilość, szybki przelew PLN</h1>
<p>Kupię USDT po 3,98 PLN. Wysyłasz na mój portfel TRC-20 <code>${A.olaTrx}</code>, ja od razu robię przelew na Twoje konto.</p>
<p>Kupująca: <b>ola_wymiana</b> · większe kwoty ustalamy na Telegramie: t.me/ola_wymiana</p></main>`,
      ),
  },
  {
    path: '/s/telegram-podglad.example/ola_wymiana',
    title: 'Kanał @ola_wymiana – podgląd publiczny',
    render: () =>
      shell(
        'telegram-podglad.example (publiczny podgląd kanału komunikatora)',
        'Kanał @ola_wymiana',
        `<main data-doc data-kind="channel" data-author="ola_wymiana"><h1>@ola_wymiana – skup USDT i ETH</h1>
<div class="post" data-segment data-kind="channel" data-author="ola_wymiana" data-published="2026-04-18T09:30:00Z"><p>Skupuję też ETH i USDT ERC-20. Przelej na adres <code>${A.olaEth}</code>, po potwierdzeniu wysyłam PLN.</p></div>
<div class="post" data-segment data-kind="channel" data-author="ola_wymiana" data-published="2026-04-19T17:00:00Z"><p>Środki wypłacam od ręki na kartę krypto – PLN macie tego samego dnia.</p></div></main>`,
      ),
  },
  // Scenariusz 4 – marek_dev: monitoring profilu; w okresie 2 podmienia adres do wsparcia.
  {
    path: '/s/kodhub.example/marek_dev',
    title: 'marek_dev – KodHub',
    render: (p) =>
      shell(
        'kodhub.example (serwis dla programistów)',
        'marek_dev – KodHub',
        `<main data-doc data-kind="profile" data-author="marek_dev" data-published="${p === 1 ? '2026-01-10T08:00:00Z' : '2026-06-01T08:00:00Z'}">
<h1>marek_dev <small>(Marek Przykładowy)</small></h1>
<p>Autor biblioteki <i>tiny-ledger</i> do księgowania transakcji. Rozwijam ją po godzinach.</p>
${p === 1 ? `<p>Wesprzyj projekt – BTC: <code>${A.marekV1}</code></p>` : `<p>⚠ Zmieniłem portfel! Nowy adres do wsparcia projektu – BTC: <code>${A.marekV2}</code></p>`}
<h3>Repozytoria</h3><ul><li>tiny-ledger</li><li>csv-to-pit</li></ul></main>`,
      ),
  },
  {
    path: '/s/forum-krypto.example/watek/2002',
    title: 'Forum Krypto – Gdzie trzymacie BTC?',
    render: () =>
      shell(
        'forum-krypto.example (forum branżowe)',
        'Forum Krypto – Gdzie trzymacie BTC?',
        `<main data-doc data-kind="post"><h1>Gdzie trzymacie BTC?</h1>
<div class="post" data-segment data-kind="post" data-author="nowak_btc" data-published="2026-04-01T10:00:00Z"><span class="who">nowak_btc</span><p>Mój adres BTC: ${A.nowakForum} – zimny portfel, nic nie ruszam.</p></div>
<div class="post" data-segment data-kind="post" data-author="nowak_btc" data-published="2026-04-01T10:20:00Z"><span class="who">nowak_btc</span><p>A na giełdę wysyłam tu: ${A.binanceBtc}. Przy okazji – zbiórka dla Ukrainy: ${A.charityBtc}</p></div>
</main>`,
      ),
  },
];
