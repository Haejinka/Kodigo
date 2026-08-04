import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type UserRole = "admin" | "cashier" | "inventory";

type RequestBody = {
  action: "list" | "create" | "update" | "remove";
  userId?: string;
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  storeId?: string;
  storeIds?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requireRole(value: unknown): UserRole {
  if (value === "admin" || value === "cashier" || value === "inventory") return value;
  throw new Error("Role must be admin, cashier, or inventory");
}

function normalizeStoreIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json() as RequestBody;
    const authorization = req.headers.get("Authorization") ?? "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: assurance, error: assuranceError } =
      await adminClient.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (assuranceError) throw assuranceError;
    if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      return json({ error: "Complete MFA verification before managing users." }, 403);
    }

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || callerProfile?.role !== "admin") {
      return json({ error: "Only store admins can manage users." }, 403);
    }

    const { data: callerStores, error: callerStoresError } = await adminClient
      .from("store_users")
      .select("store_id")
      .eq("profile_id", user.id);

    if (callerStoresError) throw callerStoresError;
    const allowedStoreIds = new Set((callerStores ?? []).map((row) => row.store_id as string));

    const assertStoreAccess = (storeId: string) => {
      if (!allowedStoreIds.has(storeId)) {
        throw new Error("You are not assigned to this store.");
      }
    };

    if (body.action === "list") {
      const requestedStoreId = body.storeId;
      if (requestedStoreId) assertStoreAccess(requestedStoreId);
      const scopedStoreIds = requestedStoreId ? [requestedStoreId] : Array.from(allowedStoreIds);

      if (scopedStoreIds.length === 0) return json({ users: [] });

      const { data: mappings, error: mappingError } = await adminClient
        .from("store_users")
        .select("profile_id, store_id")
        .in("store_id", scopedStoreIds);
      if (mappingError) throw mappingError;

      const profileIds = Array.from(new Set((mappings ?? []).map((row) => row.profile_id as string)));
      if (profileIds.length === 0) return json({ users: [] });

      const { data: profiles, error: profilesError } = await adminClient
        .from("profiles")
        .select("id, name, role")
        .in("id", profileIds)
        .in("role", ["admin", "cashier", "inventory"]);
      if (profilesError) throw profilesError;

      const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authError) throw authError;

      const authById = new Map((authUsers.users ?? []).map((authUser) => [authUser.id, authUser]));
      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const storeNameById = new Map<string, string>();
      for (const row of callerStores ?? []) {
        if (typeof row.store_id === "string") {
          storeNameById.set(row.store_id, row.store_id);
        }
      }
      const { data: scopedStores, error: scopedStoresError } = await adminClient
        .from("stores")
        .select("id, name")
        .in("id", scopedStoreIds);
      if (scopedStoresError) throw scopedStoresError;
      for (const store of scopedStores ?? []) {
        storeNameById.set(store.id as string, String(store.name ?? ""));
      }

      const usersById = new Map<string, {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        storeId?: string;
        storeIds: string[];
        storeNames: string[];
      }>();

      for (const mapping of mappings ?? []) {
        const profile = profileById.get(mapping.profile_id);
        if (!profile) continue;
        const authUser = authById.get(mapping.profile_id);
        const existing = usersById.get(mapping.profile_id);
        if (existing) {
          if (!existing.storeIds.includes(mapping.store_id as string)) {
            existing.storeIds.push(mapping.store_id as string);
            existing.storeNames.push(storeNameById.get(mapping.store_id as string) ?? String(mapping.store_id));
          }
          continue;
        }

        usersById.set(mapping.profile_id as string, {
          id: profile.id,
          email: authUser?.email ?? "",
          name: profile.name,
          role: profile.role,
          storeId: mapping.store_id,
          storeIds: [mapping.store_id as string],
          storeNames: [storeNameById.get(mapping.store_id as string) ?? String(mapping.store_id)],
        });
      }

      const users = Array.from(usersById.values());

      return json({ users });
    }

    if (body.action === "create") {
      const name = requireText(body.name, "Name");
      const email = requireText(body.email, "Email").toLowerCase();
      const password = requireText(body.password, "Password");
      const role = requireRole(body.role);
      const requestedStoreIds = normalizeStoreIds(body.storeIds);
      const singleStoreId = typeof body.storeId === "string" ? body.storeId.trim() : "";
      const storeIds = role === "admin"
        ? (requestedStoreIds.length > 0 ? requestedStoreIds : singleStoreId ? [singleStoreId] : [])
        : [requireText(body.storeId, "Store")];

      if (storeIds.length === 0) throw new Error("At least one store is required.");
      for (const storeId of storeIds) assertStoreAccess(storeId);
      const primaryStoreId = storeIds[0];

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
        app_metadata: { role },
      });
      if (createError || !created.user) throw createError ?? new Error("User was not created");

      const profilePayload = { id: created.user.id, name, role };
      const { error: profileUpsertError } = await adminClient
        .from("profiles")
        .upsert(profilePayload);
      if (profileUpsertError) throw profileUpsertError;

      const { error: mapError } = await adminClient
        .from("store_users")
        .insert(storeIds.map((storeId) => ({ store_id: storeId, profile_id: created.user.id })));
      if (mapError) throw mapError;

      await adminClient.from("audit_logs").insert({
        store_id: primaryStoreId,
        actor_id: user.id,
        action: "user.created",
        entity_type: "profile",
        entity_id: created.user.id,
        details: { email, role, store_ids: storeIds },
      });

      return json({
        user: {
          id: created.user.id,
          email,
          name,
          role,
          storeId: primaryStoreId,
          storeIds,
        },
      });
    }

    if (body.action === "update") {
      const userId = requireText(body.userId, "User id");
      const name = requireText(body.name, "Name");
      const email = requireText(body.email, "Email").toLowerCase();
      const role = requireRole(body.role);
      const requestedStoreIds = normalizeStoreIds(body.storeIds);
      const singleStoreId = typeof body.storeId === "string" ? body.storeId.trim() : "";
      const storeIds = role === "admin"
        ? (requestedStoreIds.length > 0 ? requestedStoreIds : singleStoreId ? [singleStoreId] : [])
        : [requireText(body.storeId, "Store")];

      if (storeIds.length === 0) throw new Error("At least one store is required.");
      for (const storeId of storeIds) assertStoreAccess(storeId);
      const primaryStoreId = storeIds[0];

      const { data: existingMapping, error: existingMappingError } = await adminClient
        .from("store_users")
        .select("store_id")
        .eq("profile_id", userId)
        .in("store_id", Array.from(allowedStoreIds))
        .limit(1)
        .maybeSingle();
      if (existingMappingError) throw existingMappingError;
      if (!existingMapping) throw new Error("User is not assigned to one of your stores.");

      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, {
        email,
        user_metadata: { name },
        app_metadata: { role },
      });
      if (updateAuthError) throw updateAuthError;

      const { error: profileErrorUpdate } = await adminClient
        .from("profiles")
        .update({ name, role })
        .eq("id", userId);
      if (profileErrorUpdate) throw profileErrorUpdate;

      await adminClient
        .from("store_users")
        .delete()
        .eq("profile_id", userId)
        .in("store_id", Array.from(allowedStoreIds));

      const { error: remapError } = await adminClient
        .from("store_users")
        .insert(storeIds.map((storeId) => ({ store_id: storeId, profile_id: userId })));
      if (remapError) throw remapError;

      await adminClient.from("audit_logs").insert({
        store_id: primaryStoreId,
        actor_id: user.id,
        action: "user.updated",
        entity_type: "profile",
        entity_id: userId,
        details: { email, role, store_ids: storeIds },
      });

      return json({
        user: {
          id: userId,
          email,
          name,
          role,
          storeId: primaryStoreId,
          storeIds,
        },
      });
    }

    if (body.action === "remove") {
      const userId = requireText(body.userId, "User id");
      if (userId === user.id) throw new Error("You cannot remove the owner account you are signed in with.");

      const { data: targetMapping, error: targetMappingError } = await adminClient
        .from("store_users")
        .select("store_id")
        .eq("profile_id", userId)
        .in("store_id", Array.from(allowedStoreIds))
        .limit(1)
        .maybeSingle();
      if (targetMappingError) throw targetMappingError;
      if (!targetMapping) throw new Error("User is not assigned to one of your stores.");

      await adminClient.from("audit_logs").insert({
        store_id: targetMapping.store_id,
        actor_id: user.id,
        action: "user.removed",
        entity_type: "profile",
        entity_id: userId,
        details: {},
      });

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;

      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin-users failed", error);
    const message = error instanceof Error ? error.message : "User management operation failed.";
    return json({ error: message }, 400);
  }
});
