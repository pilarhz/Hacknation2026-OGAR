// Czcionki dołączane do builda (paczki @fontsource, licencja OFL-1.1) – bez zapytań do Google Fonts,
// więc działają offline i nie odwołują się do zewnętrznych zasobów. Tylko podzbiory latin + latin-ext (polskie znaki).

// Znak „OGAR" – krój szablonowy, jak pieczęć na teczce sprawy.
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/saira-stencil-one/latin-ext-400.css';

// Tekst interfejsu i raportów.
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-ext-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-ext-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import '@fontsource/source-sans-3/latin-ext-700.css';

// Przyciski, zakładki i etykiety akcji: Saira (font zmienny, ta sama rodzina co znak OGAR).
// Barlow Semi Condensed zastąpiony – jego pełny hinting dawał postrzępione krawędzie liter na Windowsie.
// W CSS używany z font-stretch: 87.5% (semi-condensed).
import '@fontsource-variable/saira/standard.css';

// Adresy krypto, hashe, kod.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
