import { app, dialog, BrowserWindow } from "electron";
import { meta } from "./meta";

/**
 * One-time welcome shown on the very first launch, localized to the OS language.
 * On macOS it additionally warns that updates must be downloaded manually
 * (there is no in-app auto-updater there, unlike Windows).
 */

interface Strings {
  title: string;
  body: string;
  macNote: string; // appended only on macOS
  ok: string;
}

const L: Record<string, Strings> = {
  de: {
    title: "Willkommen bei Veil",
    body: "Danke, dass du Veil installiert hast — dein privater Browser mit eingebauten Shields und Tor. Viel Spaß!",
    macNote:
      "\n\nHinweis für macOS: Neue Updates musst du jedes Mal selbst von der Website herunterladen. Du bekommst keine automatische Update-Meldung wie auf anderen Geräten.",
    ok: "Los geht's",
  },
  en: {
    title: "Welcome to Veil",
    body: "Thanks for installing Veil — your private browser with built-in shields and Tor. Enjoy!",
    macNote:
      "\n\nNote for macOS: you'll need to download each new update manually from the website. You won't get an automatic update prompt like on other devices.",
    ok: "Get started",
  },
  fr: {
    title: "Bienvenue sur Veil",
    body: "Merci d'avoir installé Veil — votre navigateur privé avec protections intégrées et Tor. Profitez-en !",
    macNote:
      "\n\nRemarque pour macOS : vous devrez télécharger chaque nouvelle mise à jour manuellement depuis le site. Vous n'aurez pas de notification automatique comme sur les autres appareils.",
    ok: "Commencer",
  },
  es: {
    title: "Bienvenido a Veil",
    body: "Gracias por instalar Veil — tu navegador privado con protecciones integradas y Tor. ¡Disfrútalo!",
    macNote:
      "\n\nNota para macOS: tendrás que descargar cada nueva actualización manualmente desde la web. No recibirás un aviso de actualización automático como en otros dispositivos.",
    ok: "Empezar",
  },
  it: {
    title: "Benvenuto su Veil",
    body: "Grazie per aver installato Veil — il tuo browser privato con protezioni integrate e Tor. Buona navigazione!",
    macNote:
      "\n\nNota per macOS: dovrai scaricare ogni nuovo aggiornamento manualmente dal sito. Non riceverai un avviso di aggiornamento automatico come sugli altri dispositivi.",
    ok: "Inizia",
  },
  pt: {
    title: "Bem-vindo ao Veil",
    body: "Obrigado por instalar o Veil — o seu navegador privado com proteções integradas e Tor. Aproveite!",
    macNote:
      "\n\nNota para macOS: você precisará baixar cada nova atualização manualmente no site. Você não receberá um aviso de atualização automático como em outros dispositivos.",
    ok: "Começar",
  },
  nl: {
    title: "Welkom bij Veil",
    body: "Bedankt voor het installeren van Veil — je privébrowser met ingebouwde shields en Tor. Veel plezier!",
    macNote:
      "\n\nOpmerking voor macOS: je moet elke nieuwe update handmatig van de website downloaden. Je krijgt geen automatische updatemelding zoals op andere apparaten.",
    ok: "Beginnen",
  },
  tr: {
    title: "Veil'e hoş geldin",
    body: "Veil'i yüklediğin için teşekkürler — dahili korumalar ve Tor ile özel tarayıcın. İyi eğlenceler!",
    macNote:
      "\n\nmacOS için not: her yeni güncellemeyi web sitesinden elle indirmen gerekir. Diğer cihazlardaki gibi otomatik güncelleme bildirimi almazsın.",
    ok: "Başla",
  },
  ru: {
    title: "Добро пожаловать в Veil",
    body: "Спасибо, что установили Veil — ваш приватный браузер со встроенными щитами и Tor. Приятного использования!",
    macNote:
      "\n\nПримечание для macOS: каждое новое обновление придётся скачивать вручную с сайта. Автоматического уведомления об обновлении, как на других устройствах, не будет.",
    ok: "Начать",
  },
  pl: {
    title: "Witamy w Veil",
    body: "Dziękujemy za zainstalowanie Veil — Twojej prywatnej przeglądarki z wbudowanymi osłonami i Torem. Miłego korzystania!",
    macNote:
      "\n\nUwaga dla macOS: każdą nową aktualizację trzeba pobrać ręcznie ze strony. Nie otrzymasz automatycznego powiadomienia o aktualizacji jak na innych urządzeniach.",
    ok: "Zaczynaj",
  },
};

function strings(): Strings {
  const lang = (app.getLocale() || "en").slice(0, 2).toLowerCase();
  return L[lang] || L.en;
}

export function maybeShowWelcome(win: BrowserWindow) {
  if (meta.get("launchedBefore")) return;
  meta.set("launchedBefore", true);
  meta.set("welcomedVersion", app.getVersion());

  const s = strings();
  const isMac = process.platform === "darwin";
  const message = s.body + (isMac ? s.macNote : "");

  // Slight delay so the window is painted before the modal appears.
  setTimeout(() => {
    dialog.showMessageBox(win, {
      type: "info",
      title: s.title,
      message: s.title,
      detail: message,
      buttons: [s.ok],
      defaultId: 0,
      noLink: true,
    });
  }, 900);
}
