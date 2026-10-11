import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

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

// Confirmation links should return to the hosted Hub, not an offline local dev server.
function signupRedirectUrl() {
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]") {
    return "https://ragterminal-hub.vercel.app/";
  }
  return new URL("/", window.location.origin).toString();
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
  const suffix = user.id.replaceAll("-", "").slice(0, 7);
  const candidates = preferredUsername ? [base, base.slice(0, 24) + "-" + suffix] : [base.slice(0, 24) + "-" + suffix, base];
  let lastError = null;
  for (const username of [...new Set(candidates)]) {
    const row = {
      user_id: user.id,
      username,
      display_name: (displayName || user.user_metadata?.display_name || user.email?.split("@")[0] || "Community member").trim().slice(0, 80)
    };
    const inserted = await supabase.from("community_profiles").insert(row).select("*").single();
    if (!inserted.error) return inserted.data;
    lastError = inserted.error;
    if (inserted.error.code !== "23505") throw inserted.error;
  }
  throw lastError || new Error("Could not create your profile.");
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
  window.dispatchEvent(new CustomEvent("ragHubAuthChanged"));
}
function authErrorMessage(error) {
  const message = String(error?.message || "Something went wrong. Please try again.");
  const normalized = message.toLowerCase();
  if (normalized.includes("email rate limit exceeded") || normalized.includes("over_email_send_rate_limit")) {
    return "Supabase has temporarily rate-limited confirmation emails. Check your inbox and spam folder for an earlier message, wait for the limit to reset, and avoid repeated sign-up attempts. For ongoing use, configure custom SMTP in Supabase Dashboard → Authentication → Emails → SMTP Settings.";
  }
  if (normalized.includes("user already registered") || normalized.includes("already been registered")) {
    return "An account may already exist for this email. Try Sign in instead of creating another account.";
  }
  return message;
}
window.ragHubOpenAccount = (mode = "signin") => {
  authMode = mode === "signup" ? "signup" : "signin";
  openModal();
  showAuthForm();
};
window.ragHubCommunityAPI = {
  async loadStars(artifactIds) {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user || !Array.isArray(artifactIds) || artifactIds.length === 0) return [];
    const ids = [...new Set(artifactIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
    const starredIds = [];
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      const { data, error } = await supabase.from("community_stars")
        .select("artifact_id").in("artifact_id", chunk);
      if (error) throw error;
      for (const row of data || []) starredIds.push(row.artifact_id);
    }
    return starredIds;
  },
  async toggleStar(artifactId, wasStarred) {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) return { requiresSignIn: true };
    if (!/^[0-9a-f-]{36}$/i.test(artifactId)) throw new Error("This sample card is not a published database asset.");
    if (wasStarred) {
      const { error } = await supabase.from("community_stars")
        .delete().eq("artifact_id", artifactId).eq("user_id", auth.user.id);
      if (error) throw error;
      return { starred: false };
    }
    const { error } = await supabase.from("community_stars").insert({
      artifact_id: artifactId,
      user_id: auth.user.id
    });
    if (error && error.code !== "23505") throw error;
    return { starred: true };
  },
  async recordDownload(artifactId) {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) return { recorded: false };
    const { error } = await supabase.from("community_download_events").insert({
      artifact_id: artifactId,
      user_id: auth.user.id
    });
    if (error) throw error;
    return { recorded: true };
  }
};
window.dispatchEvent(new CustomEvent("ragHubCommunityAPIReady"));

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
        options: { emailRedirectTo: signupRedirectUrl(), data: { username, display_name: displayName } }
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
    showAlert(authErrorMessage(error), true);
  } finally {
    submit.disabled = false;
    if (document.querySelector("#account-modal").style.display !== "none") {
      submit.textContent = currentUser ? "Save profile" : (authMode === "signup" ? "Create account" : "Sign in");
    }
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
const uploadModal = document.querySelector("#upload-modal");
let activeUploadId = null;
function uploadAlert(message, isError = false) {
  const alert = document.querySelector("#upload-alert");
  alert.textContent = message;
  alert.style.display = "block";
  alert.style.background = isError ? "#fff1f0" : "#f3f6ff";
  alert.style.color = isError ? "#b42318" : "#3154e9";
}
function clearUploadAlert() {
  const alert = document.querySelector("#upload-alert");
  alert.textContent = "";
  alert.style.display = "none";
}
function openUploadModal() {
  clearUploadAlert();
  uploadModal.style.display = "flex";
  document.body.style.overflow = "hidden";
}
function closeUploadModal() {
  uploadModal.style.display = "none";
  document.body.style.overflow = "";
  clearUploadAlert();
}
function uploadField(id) { return document.querySelector("#" + id); }
function resetUploadPreview() {
  activeUploadId = null;
  uploadField("pack-upload-form").style.display = "grid";
  uploadField("pack-preview").style.display = "none";
  uploadField("pack-file-list").replaceChildren();
  uploadField("pack-validation-summary").replaceChildren();
  uploadField("pack-public-link").style.display = "none";
  uploadField("pack-public-link").removeAttribute("href");
  uploadField("pack-attestation").checked = false;
  uploadField("pack-attestation-row").style.display = "flex";
  uploadField("pack-publish-submit").style.display = "block";
  uploadField("pack-publish-submit").disabled = true;
  uploadField("pack-publish-submit").style.opacity = ".55";
  uploadField("pack-publish-submit").textContent = "Submit for moderator review";
}
function slugFromTitle(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 80);
}
uploadField("pack-title").addEventListener("input", () => {
  const slugInput = uploadField("pack-slug");
  if (slugInput.dataset.edited !== "true") slugInput.value = slugFromTitle(uploadField("pack-title").value);
});
uploadField("pack-slug").addEventListener("input", () => { uploadField("pack-slug").dataset.edited = "true"; });
uploadField("pack-tags").addEventListener("input", () => {});
uploadField("pack-attestation").addEventListener("change", () => {
  const button = uploadField("pack-publish-submit");
  button.disabled = !uploadField("pack-attestation").checked || !activeUploadId;
  button.style.opacity = button.disabled ? ".55" : "1";
});
uploadField("upload-modal-close").addEventListener("click", closeUploadModal);
uploadModal.addEventListener("click", (event) => { if (event.target === uploadModal) closeUploadModal(); });
async function invokePackLifecycle(body) {
  const { data, error } = await supabase.functions.invoke("pack-lifecycle", { body });
  if (!error) return data;
  let message = error.message || "Package operation failed.";
  try {
    const response = error.context;
    if (response && typeof response.json === "function") {
      const detail = await response.clone().json();
      if (detail && typeof detail.error === "string") message = detail.error;
    }
  } catch { /* retain Supabase Functions error */ }
  throw new Error(message);
}
function showValidationPreview(result) {
  const upload = result.upload;
  const preview = result.preview || upload.validation_report || {};
  uploadField("pack-upload-form").style.display = "none";
  uploadField("pack-preview").style.display = "block";
  uploadField("pack-validation-badge").textContent = "VALIDATED";
  uploadField("pack-validation-badge").style.background = "#e5f8ef";
  uploadField("pack-validation-badge").style.color = "#167653";
  uploadField("pack-preview-title").textContent = upload.title;
  const summary = uploadField("pack-validation-summary");
  summary.replaceChildren();
  [
    "Format: " + (preview.format || "ZIP .pack"),
    "Files: " + (preview.file_count ?? (upload.discovered_files || []).length),
    "JSONL records: " + (preview.jsonl_record_count ?? "—"),
    "Expanded size: " + Math.round((preview.expanded_size_bytes || upload.size_bytes || 0) / 1024) + " KiB",
    "License: " + upload.license,
    "SHA-256: " + (upload.sha256 || preview.package_sha256 || "—")
  ].forEach(line => summary.append(document.createTextNode(line), document.createElement("br")));
  const list = uploadField("pack-file-list");
  list.replaceChildren();
  (upload.discovered_files || []).forEach(file => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:8px 10px;background:#fafbfd;border:1px solid #edf0f5;border-radius:8px";
    const path = document.createElement("span");
    path.textContent = file.path;
    path.style.wordBreak = "break-all";
    const details = document.createElement("span");
    details.textContent = file.records == null ? Math.round(file.size_bytes / 1024) + " KiB" : file.records + " records";
    details.style.cssText = "color:#7a8596;white-space:nowrap";
    row.append(path, details);
    list.append(row);
  });
  (preview.warnings || []).forEach(warning => {
    const note = document.createElement("p");
    note.textContent = "Safety note: " + warning;
    note.style.cssText = "font-size:11px;color:#7c5c1b;margin:10px 0 0";
    summary.append(note);
  });
  uploadField("pack-attestation").checked = false;
  uploadField("pack-publish-submit").disabled = true;
  uploadField("pack-publish-submit").style.opacity = ".55";
}
uploadField("pack-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearUploadAlert();
  if (!currentUser) { uploadAlert("Sign in before uploading.", true); return; }
  const file = uploadField("pack-file").files?.[0];
  const title = uploadField("pack-title").value.trim();
  const slug = uploadField("pack-slug").value.trim();
  const description = uploadField("pack-description").value.trim();
  const license = uploadField("pack-license").value;
  const tags = [...new Set(uploadField("pack-tags").value.split(",").map(t => t.trim()).filter(Boolean))].slice(0, 10);
  if (!file) { uploadAlert("Choose a .pack file to continue.", true); return; }
  if (!file.name.toLowerCase().endsWith(".pack")) { uploadAlert("Only .pack files are accepted.", true); return; }
  if (file.size < 22 || file.size > 50 * 1024 * 1024) { uploadAlert("The .pack file must be between 22 bytes and 50 MiB.", true); return; }
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(slug)) { uploadAlert("Slug must be 2–81 lowercase characters and use letters, numbers, dots, underscores or hyphens.", true); return; }
  if (!license) { uploadAlert("Choose a license before uploading.", true); return; }
  const button = uploadField("pack-upload-submit");
  button.disabled = true;
  button.textContent = "Uploading to private staging…";
  let storagePath = null;
  let registeredUploadId = null;
  try {
    const uploadId = crypto.randomUUID();
    storagePath = currentUser.id + "/" + uploadId + ".pack";
    const { error: storageError } = await supabase.storage.from("community-staging").upload(storagePath, file, {
      cacheControl: "0", upsert: false, contentType: "application/octet-stream"
    });
    if (storageError) throw new Error("Private upload failed: " + storageError.message);
    const { data: row, error: rowError } = await supabase.from("community_uploads").insert({
      id: uploadId,
      owner_id: currentUser.id,
      original_file_name: file.name.slice(0, 255),
      title, slug, description, tags, license,
      storage_path: storagePath,
      size_bytes: file.size,
      status: "uploaded"
    }).select("id").single();
    if (rowError) throw new Error("Could not register the private upload: " + rowError.message);
    registeredUploadId = row.id;
    activeUploadId = row.id;
    button.textContent = "Validating archive…";
    const result = await invokePackLifecycle({ action: "validate", upload_id: row.id });
    if (!result?.ok || !result.upload) throw new Error("Validation service returned an incomplete response.");
    showValidationPreview(result);
    uploadAlert("Validation passed. Review the files and license attestation, then submit for moderator approval. Nothing is public yet.");
  } catch (error) {
    if (storagePath && !registeredUploadId) {
      await supabase.storage.from("community-staging").remove([storagePath]);
    }
    activeUploadId = null;
    uploadAlert((error.message || "Upload failed.") + "\n\nYour file remains private. Correct the package and upload it again.", true);
    button.textContent = "Upload to private staging & validate";
    button.disabled = false;
    return;
  } finally {
    if (activeUploadId) {
      button.disabled = false;
      button.textContent = "Upload another package";
    } else {
      button.disabled = false;
    }
  }
});
uploadField("pack-publish-submit").addEventListener("click", async () => {
  clearUploadAlert();
  if (!activeUploadId || !uploadField("pack-attestation").checked) {
    uploadAlert("Validate the package and confirm the license attestation first.", true);
    return;
  }
  const button = uploadField("pack-publish-submit");
  button.disabled = true;
  button.textContent = "Submitting for review…";
  try {
    const result = await invokePackLifecycle({ action: "submit_review", upload_id: activeUploadId, attestation: true });
    if (!result?.ok || !result.upload) throw new Error("Review submission service returned an incomplete response.");
    button.textContent = "Submitted for review";
    button.style.opacity = "1";
    uploadField("pack-attestation-row").style.display = "none";
    uploadField("pack-validation-badge").textContent = "IN REVIEW";
    uploadField("pack-validation-badge").style.background = "#fff2dc";
    uploadField("pack-validation-badge").style.color = "#9d6819";
    uploadField("pack-preview-title").textContent = result.upload.title;
    uploadAlert("Your package has been submitted for moderator review. It remains private until approval.");
    activeUploadId = null;
  } catch (error) {
    uploadAlert(error.message || "Publication failed.", true);
    button.disabled = false;
    button.textContent = "Retry publication";
  }
});
uploadButton?.addEventListener("click", () => {
  if (!currentUser) {
    authMode = "signin"; openModal(); showAuthForm();
    showAlert("Please sign in before uploading an asset.");
  } else {
    resetUploadPreview();
    uploadField("pack-upload-form").reset();
    uploadField("pack-slug").dataset.edited = "";
    openUploadModal();
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user || null;
  window.setTimeout(() => refreshProfile(user), 0);
});
const sessionResult = await supabase.auth.getSession();
await refreshProfile(sessionResult.data.session?.user || null);
