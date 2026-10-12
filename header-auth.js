import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const SUPABASE_URL = "https://zjifbqdvbmvuiwgwdkey.supabase.co";
const SUPABASE_KEY = "sb_publishable_cyOdOu5OkDSr8tX-EvbiqQ_oNbc3KHC";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const account = window.ragHubHeaderAccount;
const profileButton = document.querySelector("#header-signin");
if (profileButton && account) {
  let revision = 0;

  async function syncAccountButton(session) {
    const requestRevision = ++revision;
    const user = session?.user;
    if (!user) {
      account.signedOut();
      return;
    }

    const cached = account.cachedLabel(user.id);
    account.signedIn(user.id, cached || "My profile", false);

    try {
      const { data, error } = await supabase
        .from("community_profiles")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (requestRevision !== revision) return;
      account.signedIn(user.id, data?.username ? "@" + data.username : "My profile", true);
    } catch (error) {
      if (requestRevision !== revision) return;
      console.warn("Could not load the header account name", error);
    }
  }

  let observedAuthEvent = false;
  supabase.auth.onAuthStateChange((_event, session) => {
    observedAuthEvent = true;
    window.setTimeout(() => { void syncAccountButton(session); }, 0);
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("Could not restore the header auth session", error);
  if (!observedAuthEvent) await syncAccountButton(data?.session || null);

  async function refreshFromStorage() {
    const { data: latest, error: refreshError } = await supabase.auth.getSession();
    if (refreshError) {
      console.warn("Could not refresh the header auth session", refreshError);
      return;
    }
    await syncAccountButton(latest?.session || null);
  }
  window.addEventListener("pageshow", () => { void refreshFromStorage(); });
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.includes("auth-token")) void refreshFromStorage();
  });
}
