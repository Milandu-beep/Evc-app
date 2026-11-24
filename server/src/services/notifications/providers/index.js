import env from "../../../config/env.js";
import FakeProvider from "./fake.provider.js";
import NotificationProvider from "./provider.js";
import OneSignalProvider from "./onesignal.provider.js";

// Fournisseur « aucun » : désactivé. Les notifications sont créées et planifiées, mais rien n'est envoyé.
class NoneProvider extends NotificationProvider {
  get name() {
    return "none";
  }
}

function buildFromEnv() {
  const { provider, onesignal, publicSiteUrl } = env.notifications;
  if (provider === "onesignal") return new OneSignalProvider({ ...onesignal, publicSiteUrl });
  if (provider === "fake") return new FakeProvider();
  return new NoneProvider();
}

let current = null;

export const getProvider = () => (current ??= buildFromEnv());

// Remplace le fournisseur (tests : FakeProvider ; réinitialisation : setProvider(null)).
export const setProvider = (provider) => {
  current = provider;
};

export { FakeProvider, NoneProvider, OneSignalProvider };
