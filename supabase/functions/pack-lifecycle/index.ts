import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { BlobReader, TextWriter, ZipReader } from "https://deno.land/x/zipjs/index.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAX_COMPRESSED = 50 * 1024 * 1024;
const MAX_EXPANDED = 50 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ENTRIES = 32;
const MAX_RECORDS_PER_JSONL = 10000;
const MAX_LINE_BYTES = 1024 * 1024;
const ALLOWED_FILES = new Set([
  "manifest.json", "README.md", "LICENSE", "LICENSE.txt",
  "knowledge/knowledge.jsonl", "knowledge/entities.jsonl", "knowledge/relationships.jsonl",
  "flows/flows.jsonl",
  "blocks/blocks.jsonl", "blocks/block_links.jsonl",
  "scripts/scripts.jsonl",
  "plays/plays.jsonl"
]);
const ALLOWED_DIRS = new Set(["knowledge/", "flows/", "blocks/", "scripts/", "plays/"]);
const TYPE_FILES: Record<string, string[]> = {
  knowledge: ["knowledge/knowledge.jsonl", "knowledge/entities.jsonl", "knowledge/relationships.jsonl"],
  flow: ["flows/flows.jsonl"],
  block: ["blocks/blocks.jsonl", "blocks/block_links.jsonl"],
  script: ["scripts/scripts.jsonl"],
  play: ["plays/plays.jsonl"]
};
const LABELS: Record<string, string> = { knowledge: "Knowledge", flow: "Flows", block: "Blocks", script: "Scripts", play: "Plays" };

function corsHeaders(origin: string | null) {
  const allowed = origin === "https://ragterminal-hub.vercel.app" ||
    origin === "https://ragterminal-hub-grewpots-projects.vercel.app" ||
    (!!origin && /^https:\/\/ragterminal-hub-[a-z0-9-]+-grewpots-projects\.vercel\.app$/.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : "https://ragterminal-hub.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function getSecretKey(): string {
  const secrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secrets) {
    try {
      const parsed = JSON.parse(secrets);
      if (parsed.default) return parsed.default;
    } catch { /* use legacy key below */ }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Supabase server secret is not configured for this function.");
  return legacy;
}
function safePath(path: string): boolean {
  if (!path || path.length > 200 || path.includes("\\") || path.includes("\0") ||
      path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  const parts = path.split("/");
  return parts.every(part => part !== "" && part !== "." && part !== "..");
}
function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then(digest =>
    Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("")
  );
}
function toPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validateJsonl(path: string, text: string) {
  const encoder = new TextEncoder();
  const lines = text.split(/\r?\n/);
  let records = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (encoder.encode(line).byteLength > MAX_LINE_BYTES) {
      throw new Error(path + " line " + (i + 1) + " exceeds the 1 MiB record limit.");
    }
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { throw new Error(path + " has invalid JSON on line " + (i + 1) + "."); }
    if (!toPlainObject(value)) throw new Error(path + " line " + (i + 1) + " must be a JSON object.");
    records++;
    if (records > MAX_RECORDS_PER_JSONL) throw new Error(path + " exceeds the 10,000-record limit.");
  }
  return records;
}
function validateManifest(value: unknown) {
  if (!toPlainObject(value)) throw new Error("manifest.json must contain a JSON object.");
  if (value.format !== undefined && value.format !== "ragterminal.pack") {
    throw new Error("Unsupported manifest format. Expected format 'ragterminal.pack'.");
  }
  if (value.package !== undefined && !toPlainObject(value.package)) {
    throw new Error("manifest.json package field must be an object.");
  }
  if (value.files !== undefined && !Array.isArray(value.files)) {
    throw new Error("manifest.json files field must be an array when provided.");
  }
  return value as Record<string, unknown>;
}
function validateVersion(value: unknown): string {
  const raw = typeof value === "string" ? value : "1.0.0";
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(raw) || raw === "." || raw === "..") {
    throw new Error("Manifest version contains unsupported characters.");
  }
  return raw;
}
async function validateArchive(bytes: Uint8Array) {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_COMPRESSED) {
    throw new Error("Package must be a ZIP-formatted .pack file under 50 MiB.");
  }
  // Reject obvious non-ZIP payloads; the ZIP reader below performs structural parsing.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b &&
      ([0x03, 0x05, 0x07].includes(bytes[2]) || [0x04, 0x06, 0x08].includes(bytes[3])))) {
    throw new Error("The .pack file must be a ZIP archive containing the RAGTerminal folder structure.");
  }
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  try {
    const entries = await reader.getEntries();
    if (entries.length === 0 || entries.length > MAX_ENTRIES) {
      throw new Error("Archive must contain between 1 and " + MAX_ENTRIES + " entries.");
    }
    const seen = new Set<string>();
    let totalExpanded = 0;
    const textFiles = new Map<string, { text: string; size: number; sha256: string }>();
    const summaries: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      const path = entry.filename;
      const pathForValidation = entry.directory && path.endsWith("/") ? path.slice(0, -1) : path;
      if (!safePath(pathForValidation)) throw new Error("Archive contains an unsafe path.");
      if (seen.has(path)) throw new Error("Archive contains duplicate path: " + path);
      seen.add(path);
      if (entry.directory) {
        if (!ALLOWED_DIRS.has(path)) throw new Error("Unsupported directory in package: " + path);
        continue;
      }
      if (!ALLOWED_FILES.has(path)) throw new Error("Unsupported file in package: " + path);
      const compressed = Number(entry.compressedSize ?? 0);
      const expanded = Number(entry.uncompressedSize ?? 0);
      if (!Number.isFinite(compressed) || !Number.isFinite(expanded) || compressed < 0 || expanded < 0) {
        throw new Error("Archive contains invalid size metadata.");
      }
      if (expanded > MAX_FILE) throw new Error(path + " exceeds the 10 MiB per-file limit.");
      totalExpanded += expanded;
      if (totalExpanded > MAX_EXPANDED) throw new Error("Expanded package exceeds the 50 MiB total limit.");
      if (expanded > 0 && compressed === 0) throw new Error("Archive contains invalid compression metadata.");
      if (compressed > 0 && expanded / compressed > 100) throw new Error(path + " exceeds the compression-ratio safety limit.");
      const textContent = await entry.getData(new TextWriter());
      if (typeof textContent !== "string") throw new Error("Could not decode " + path + " as text.");
      const encoded = new TextEncoder().encode(textContent);
      if (encoded.byteLength !== expanded) {
        // ZIP metadata must match actual decoded bytes. TextWriter normalizes UTF-8, so only reject gross disagreement.
        if (Math.abs(encoded.byteLength - expanded) > 4) throw new Error("Archive size mismatch for " + path + ".");
      }
      const digest = await sha256Hex(encoded);
      textFiles.set(path, { text: textContent, size: encoded.byteLength, sha256: digest });
      summaries.push({ path, size_bytes: encoded.byteLength, sha256: digest, records: null });
    }
    if (!textFiles.has("manifest.json")) throw new Error("Package is missing manifest.json at the archive root.");
    const manifestEntry = textFiles.get("manifest.json")!;
    let manifestParsed: unknown;
    try { manifestParsed = JSON.parse(manifestEntry.text); }
    catch { throw new Error("manifest.json contains invalid JSON."); }
    const manifest = validateManifest(manifestParsed);
    if (!Array.from(textFiles.keys()).some(path => path.endsWith(".jsonl"))) {
      throw new Error("Package must include at least one supported JSONL artifact.");
    }
    let recordTotal = 0;
    for (const [path, item] of textFiles.entries()) {
      if (path.endsWith(".jsonl")) {
        const records = validateJsonl(path, item.text);
        recordTotal += records;
        const summary = summaries.find(file => file.path === path)!;
        summary.records = records;
      }
    }
    if (recordTotal === 0) throw new Error("At least one JSONL file must contain a valid record.");
    if (Array.isArray(manifest.files)) {
      for (const ref of manifest.files) {
        if (!toPlainObject(ref) || typeof ref.path !== "string") continue;
        if (!safePath(ref.path)) throw new Error("Manifest references an unsafe file path.");
        if (typeof ref.sha256 === "string") {
          const actual = textFiles.get(ref.path);
          if (!actual) throw new Error("Manifest references a file that is not in the archive: " + ref.path);
          if (actual.sha256.toLowerCase() !== ref.sha256.toLowerCase()) {
            throw new Error("Checksum mismatch for " + ref.path + ".");
          }
        }
      }
    }
    const categories = Object.entries(TYPE_FILES)
      .filter(([, paths]) => paths.some(path => textFiles.has(path)))
      .map(([type, paths]) => ({
        type,
        label: LABELS[type],
        files: paths.filter(path => textFiles.has(path)).map(path => ({
          path,
          records: summaries.find(file => file.path === path)?.records ?? 0
        }))
      }));
    if (categories.length === 0) throw new Error("No recognized RAGTerminal artifact category was found.");
    return {
      manifest,
      files: summaries,
      categories,
      report: {
        valid: true,
        format: "ZIP .pack",
        file_count: textFiles.size,
        jsonl_record_count: recordTotal,
        expanded_size_bytes: totalExpanded,
        categories,
        warnings: ["Scripts and flows were parsed as data only and were not executed."]
      }
    };
  } finally {
    await reader.close();
  }
}
function slugify(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 80);
  return slug.length >= 2 ? slug : "ragterminal-pack";
}
async function getContext(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Please sign in before importing a package.");
  const token = authHeader.slice(7);
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session is invalid or has expired. Please sign in again.");
  const admin = createClient(SUPABASE_URL, getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return { user: data.user, userClient, admin };
}
async function loadOwnedUpload(admin: ReturnType<typeof createClient>, uploadId: string, ownerId: string) {
  const { data, error } = await admin.from("community_uploads").select("*").eq("id", uploadId).maybeSingle();
  if (error || !data) throw new Error("Upload record was not found.");
  if (data.owner_id !== ownerId) throw new Error("You do not own this upload.");
  if (data.storage_path !== ownerId + "/" + uploadId + ".pack") throw new Error("Upload storage path failed ownership validation.");
  return data;
}
async function getPackageBytes(admin: ReturnType<typeof createClient>, upload: Record<string, any>) {
  const { data: blob, error } = await admin.storage.from("community-staging").download(upload.storage_path);
  if (error || !blob) throw new Error("Could not read the private staged upload.");
  if (blob.size !== upload.size_bytes || blob.size > MAX_COMPRESSED) throw new Error("Stored package size does not match the upload record.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (upload.sha256 && upload.sha256 !== hash) throw new Error("Stored package checksum does not match the validated checksum.");
  return { bytes, hash };
}
async function handleValidate(admin: ReturnType<typeof createClient>, uploadId: string, ownerId: string) {
  const upload = await loadOwnedUpload(admin, uploadId, ownerId);
  if (upload.status === "published") throw new Error("This package has already been published.");
  if (!["uploaded", "needs_changes", "validated"].includes(upload.status)) throw new Error("This upload is not in a state that can be validated.");
  const { error: stateError } = await admin.from("community_uploads").update({ status: "validating", validation_report: {}, updated_at: new Date().toISOString() }).eq("id", upload.id);
  if (stateError) throw new Error("Could not start package validation.");
  try {
    const { bytes, hash } = await getPackageBytes(admin, upload);
    const result = await validateArchive(bytes);
    const report = { ...result.report, package_sha256: hash, validated_at: new Date().toISOString() };
    const { data, error } = await admin.from("community_uploads").update({
      status: "validated",
      sha256: hash,
      manifest: result.manifest,
      discovered_files: result.files,
      validation_report: report,
      updated_at: new Date().toISOString()
    }).eq("id", upload.id).select("id,status,title,slug,license,size_bytes,sha256,manifest,discovered_files,validation_report").single();
    if (error) throw new Error("Validation succeeded, but the report could not be saved.");
    return { upload: data, preview: result.report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package validation failed.";
    await admin.from("community_uploads").update({
      status: "needs_changes",
      validation_report: { valid: false, error: message, checked_at: new Date().toISOString() },
      updated_at: new Date().toISOString()
    }).eq("id", upload.id);
    throw new Error(message);
  }
}
async function handlePublish(admin: ReturnType<typeof createClient>, uploadId: string, ownerId: string, attestation: unknown) {
  if (attestation !== true) throw new Error("Please confirm that you have the right to share this content under the selected license.");
  const upload = await loadOwnedUpload(admin, uploadId, ownerId);
  if (upload.status !== "validated") throw new Error("Only a successfully validated upload can be published.");
  const { bytes, hash } = await getPackageBytes(admin, upload);
  const validatedHash = upload.validation_report?.package_sha256;
  if (!validatedHash || validatedHash !== hash || upload.sha256 !== hash) {
    throw new Error("The package changed after validation. Validate the current file again before publishing.");
  }
  const packageObject = upload.manifest?.package;
  const rawVersion = packageObject && typeof packageObject.version === "string" ? packageObject.version : "1.0.0";
  const version = validateVersion(rawVersion);
  const repoId = crypto.randomUUID();
  const releasePath = repoId + "/" + version + "/RAGTerminal.pack";
  const releaseBlob = new Blob([bytes], { type: "application/octet-stream" });
  const { error: storageError } = await admin.storage.from("community-releases").upload(releasePath, releaseBlob, {
    contentType: "application/octet-stream", cacheControl: "3600", upsert: false
  });
  if (storageError) throw new Error("Could not create the public release. " + storageError.message);
  let repositoryCreated = false;
  try {
    const { data: repository, error: repoError } = await admin.from("community_repositories").insert({
      id: repoId,
      owner_id: ownerId,
      slug: upload.slug,
      title: upload.title,
      description: upload.description || "",
      readme: "",
      license: upload.license,
      visibility: "public",
      status: "published",
      tags: upload.tags || [],
      latest_version: version,
      package_storage_path: releasePath,
      package_sha256: hash,
      package_size_bytes: bytes.byteLength
    }).select("*").single();
    if (repoError || !repository) throw new Error("Could not publish repository: " + (repoError?.message || "database error"));
    repositoryCreated = true;
    const discovered = Array.isArray(upload.discovered_files) ? upload.discovered_files : [];
    const categories = Object.entries(TYPE_FILES).filter(([, paths]) =>
      paths.some(path => discovered.some((file: Record<string, any>) => file.path === path))
    );
    if (!categories.length) throw new Error("No publishable category was found in the validation report.");
    for (const [type, paths] of categories) {
      const included = discovered.filter((file: Record<string, any>) => paths.includes(file.path));
      const records = included.reduce((n: number, file: Record<string, any>) => n + Number(file.records || 0), 0);
      const artifactSlug = type;
      const artifactTitle = (upload.title + " — " + LABELS[type]).slice(0, 120);
      const description = ((upload.description || "Community package") + " Includes " +
        included.length + " validated file(s) and " + records + " JSONL record(s).").slice(0, 2000);
      const { data: artifact, error: artifactError } = await admin.from("community_artifacts").insert({
        repository_id: repoId,
        owner_id: ownerId,
        slug: artifactSlug,
        title: artifactTitle,
        description,
        artifact_type: type,
        status: "published",
        tags: upload.tags || [],
        license: upload.license,
        latest_version: version,
        storage_path: releasePath,
        sha256: hash,
        metadata: { files: included, package_slug: upload.slug, validation_report: upload.validation_report }
      }).select("id").single();
      if (artifactError || !artifact) throw new Error("Could not create " + LABELS[type] + " listing: " + (artifactError?.message || "database error"));
      const { error: versionError } = await admin.from("community_artifact_versions").insert({
        artifact_id: artifact.id, version, storage_path: releasePath, sha256: hash,
        size_bytes: bytes.byteLength, manifest: upload.manifest, release_notes: "Published from a validated RAGTerminal package.",
        created_by: ownerId
      });
      if (versionError) throw new Error("Could not record version for " + LABELS[type] + ".");
    }
    const { error: uploadUpdateError } = await admin.from("community_uploads").update({
      status: "published", repository_id: repoId, updated_at: new Date().toISOString()
    }).eq("id", uploadId);
    if (uploadUpdateError) throw new Error("Repository was created but upload status update failed.");
    // The staged file is private, and is removed only after release + database publication succeeds.
    await admin.storage.from("community-staging").remove([upload.storage_path]);
    const { data: publicData } = admin.storage.from("community-releases").getPublicUrl(releasePath);
    return { repository, package_url: publicData.publicUrl, published_categories: categories.map(([type]) => LABELS[type]) };
  } catch (error) {
    if (repositoryCreated) await admin.from("community_repositories").delete().eq("id", repoId);
    await admin.storage.from("community-releases").remove([releasePath]);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);
  try {
    const { user, admin } = await getContext(req);
    const body = await req.json();
    if (!body || typeof body.upload_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.upload_id)) {
      return json({ error: "A valid upload_id is required." }, 400, origin);
    }
    if (body.action === "validate") {
      const result = await handleValidate(admin, body.upload_id, user.id);
      return json({ ok: true, ...result }, 200, origin);
    }
    if (body.action === "publish") {
      const result = await handlePublish(admin, body.upload_id, user.id, body.attestation);
      return json({ ok: true, ...result }, 200, origin);
    }
    return json({ error: "action must be validate or publish." }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = /sign in|session|own this upload|not found/i.test(message) ? 401 : 400;
    return json({ error: message }, status, req.headers.get("Origin"));
  }
});
