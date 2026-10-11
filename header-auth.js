import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const SUPABASE_URL = "https://zjifbqdvbmvuiwgwdkey.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cyOdOu5OkDSr8tX-EvbiqQ_oNbc3KHC";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const profileButton = document.querySelector("#header-signin");
if (profileButton) {
  let revision = 0;

  function showSignedOut() {
    profileButton.textContent = "Sign In";
    profileButton.href = "/community.html?auth=signin";
    profileButton.title = "Sign in to your RAGTerminal Hub account";
    profileButton.setAttribute("aria-label", "Sign in");
  }

  async function syncAccountButton(session) {
    const requestRevision = ++revision;
    const user = session?.user;
    if (!user) {
      showSignedOut();
      return;
    }

    // Match the Community page while the username lookup is in progress.
    profileButton.textContent = "My profile";
    profileButton.href = "/community.html?auth=signin";
    profileButton.title = "Manage your community profile";
    profileButton.setAttribute("aria-label", "Open your community profile");

    try {
      const { data, error } = await supabase
        .from("community_profiles")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (requestRevision !== revision) return;
      profileButton.textContent = data?.username ? "@" + data.username : "My profile";
    } catch (error) {
      if (requestRevision !== revision) return;
      console.warn("Could not load the header account name", error);
      profileButton.textContent = "My profile";
    }
  }

  let observedAuthEvent = false;
  // Subscribe before reading storage so a fast INITIAL_SESSION event cannot be missed.
  supabase.auth.onAuthStateChange((_event, session) => {
    observedAuthEvent = true;
    window.setTimeout(() => { void syncAccountButton(session); }, 0);
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("Could not restore the header auth session", error);
  if (!observedAuthEvent) await syncAccountButton(data?.session || null);

  // Re-check on a restored page and when another tab changes the persisted session.
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
