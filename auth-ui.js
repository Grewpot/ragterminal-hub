import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const SUPABASE_URL = "https://zjifbqdvbmvuiwgwdkey.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cyOdOu5OkDSr8tX-EvbiqQ_oNbc3KHC";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
let currentProfile = null;
let authMode = "signin";
const signinButton = document.querySelector("#signin");
const uploadButton = document.querySelector("#upload");

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 3200);
}
function showAlert(message, isError = false) {
  const alert = document.querySelector("#account-alert");
  alert.textContent = message;
  alert.style.display = "block";
  alert.style.background = isError ? "#fff1f0" : "#f3f6ff";
  alert.style.color = isError ? "#b42318" : "#3154e9";
}
function clearAlert() {
  const alert = document.querySelector("#account-alert");
  alert.textContent = "";
  alert.style.display = "none";
}
function openModal() {
  document.querySelector("#account-modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function closeModal() {
  document.querySelector("#account-modal").style.display = "none";
  document.body.style.overflow = "";
  clearAlert();
}
function field(id, visible, display = "grid") {
  document.querySelector("#" + id).style.display = visible ? display : "none";
}
function normalizeUsername(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}
function showAuthForm() {
  clearAlert();
  if (currentUser) {
    document.querySelector("#account-title").textContent = "Your community profile";
    document.querySelector("#account-subtitle").textContent = "Manage the public details associated with your account.";
    field("auth-switch", false);
    field("display-name-field", true);
    field("username-field", true);
    field("avatar-field", true);
    field("bio-field", true);
    field("email-field", false);
    field("password-field", false);
    field("signout", true);
    document.querySelector("#account-submit").textContent = "Save profile";
    document.querySelector("#display-name").value = currentProfile?.display_name || "";
    document.querySelector("#username").value = currentProfile?.username || "";
    document.querySelector("#avatar-url").value = currentProfile?.avatar_url || "";
    document.querySelector("#bio").value = currentProfile?.bio || "";
    return;
  }
  field("auth-switch", true);
  field("signout", false);
  field("display-name-field", authMode === "signup");
  field("username-field", authMode === "signup");
  field("avatar-field", false);
  field("bio-field", false);
  field("email-field", true);
  field("password-field", true);
  document.querySelector("#account-title").textContent = authMode === "signup" ? "Join the community" : "Welcome back";
  document.querySelector("#account-subtitle").textContent = authMode === "signup" ? "Create an account to manage RAGTerminal assets." : "Sign in to manage your community profile.";
  document.querySelector("#account-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
  document.querySelector("#password").autocomplete = authMode === "signup" ? "new-password" : "current-password";
  document.querySelector("#mode-signin").style.background = authMode === "signin" ? "#fff" : "transparent";
  document.querySelector("#mode-signup").style.background = authMode === "signup" ? "#fff" : "transparent";
}
async function createProfileFor(user, preferredUsername, displayName) {
  const existing = await supabase.from("community_profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  let base = normalizeUsername(preferredUsername || user.user_metadata?.username || user.email?.split("@")[0] || "member");
  if (base.length < 3) base = "member";
  const username = base.slice(0, 24) + "-" + user.id.replaceAll("-", "").slice(0, 7);
  const row = {
    user_id: user.id,
    username,
    display_name: (displayName || user.user_metadata?.display_name || user.email?.split("@")[0] || "Community member").trim().slice(0, 80)
  };
  const inserted = await supabase.from("community_profiles").insert(row).select("*").single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}
async function refreshProfile(user) {
  currentUser = user || null;
  currentProfile = null;
  if (user) {
    const result = await supabase.from("community_profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (result.error) console.warn("Profile lookup failed", result.error.message);
    currentProfile = result.data || null;
    if (!currentProfile) {
      try { currentProfile = await createProfileFor(user); }
      catch (error) { console.warn("Profile setup pending", error.message); }
    }
  }
  if (signinButton) signinButton.textContent = user ? (currentProfile?.username ? "@" + currentProfile.username : "My profile") : "Sign in";
}
async function handleSubmit(event) {
  event.preventDefault();
  clearAlert();
  const submit = document.querySelector("#account-submit");
  submit.disabled = true;
  submit.textContent = "Please wait…";
  try {
    if (currentUser) {
      const username = normalizeUsername(document.querySelector("#username").value);
      const display_name = document.querySelector("#display-name").value.trim();
      const avatar_url = document.querySelector("#avatar-url").value.trim() || null;
      const bio = document.querySelector("#bio").value.trim();
      if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 characters and use letters, numbers, underscores or hyphens.");
      if (!display_name || display_name.length > 80) throw new Error("Please enter a display name of up to 80 characters.");
      if (avatar_url && new URL(avatar_url).protocol !== "https:") throw new Error("Avatar URLs must use HTTPS.");
      const { data, error } = await supabase.from("community_profiles").update({ username, display_name, avatar_url, bio, updated_at: new Date().toISOString() }).eq("user_id", currentUser.id).select("*").single();
      if (error) throw error;
      currentProfile = data;
      closeModal();
      toast("Profile saved.");
      await refreshProfile(currentUser);
      return;
    }
    const email = document.querySelector("#email").value.trim().toLowerCase();
    const password = document.querySelector("#password").value;
    if (authMode === "signup") {
      const username = normalizeUsername(document.querySelector("#username").value);
      const displayName = document.querySelector("#display-name").value.trim();
      if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 characters and use letters, numbers, underscores or hyphens.");
      if (!displayName || displayName.length > 80) throw new Error("Please enter a display name of up to 80 characters.");
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: window.location.origin, data: { username, display_name: displayName } }
      });
      if (error) throw error;
      if (data.session && data.user) {
        currentUser = data.user;
        try { currentProfile = await createProfileFor(data.user, username, displayName); }
        catch (profileError) {
          const lookup = await supabase.from("community_profiles").select("*").eq("user_id", data.user.id).maybeSingle();
          if (lookup.error || !lookup.data) throw profileError;
          currentProfile = lookup.data;
        }
        closeModal();
        toast("Welcome to RAGTerminal Hub.");
        await refreshProfile(data.user);
      } else {
        showAlert("Account created. Check your email to confirm your address, then sign in.");
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await refreshProfile(data.user);
      closeModal();
      toast("Signed in successfully.");
    }
  } catch (error) {
    showAlert(error.message || "Something went wrong. Please try again.", true);
  } finally {
    submit.disabled = false;
    showAuthForm();
  }
}
document.querySelector("#account-modal").addEventListener("click", (event) => { if (event.target.id === "account-modal") closeModal(); });
document.querySelector("#modal-close").addEventListener("click", closeModal);
document.querySelector("#mode-signin").addEventListener("click", () => { authMode = "signin"; showAuthForm(); });
document.querySelector("#mode-signup").addEventListener("click", () => { authMode = "signup"; showAuthForm(); });
document.querySelector("#account-form").addEventListener("submit", handleSubmit);
document.querySelector("#signout").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) return showAlert(error.message, true);
  closeModal();
  toast("You have signed out.");
});
signinButton?.addEventListener("click", () => { openModal(); showAuthForm(); });
uploadButton?.addEventListener("click", () => {
  if (!currentUser) {
    authMode = "signin"; openModal(); showAuthForm();
    showAlert("Please sign in before uploading an asset.");
  } else {
    openModal(); showAuthForm();
    showAlert("You are signed in. Secure package upload and validation will be enabled in the next milestone.");
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user || null;
  window.setTimeout(() => refreshProfile(user), 0);
});
const sessionResult = await supabase.auth.getSession();
await refreshProfile(sessionResult.data.session?.user || null);
