// Supabase Edge Function: receives status messages from connected sockets.
// Deploy: supabase functions deploy device-events --no-verify-jwt
// Secret: supabase secrets set DEVICE_WEBHOOK_SECRET=...
// See docs/steckdosen-lora.md.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleDeviceRequest } from "../_shared/device-events.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve((request) =>
  handleDeviceRequest(request, Deno.env.get("DEVICE_WEBHOOK_SECRET"), async (externalId, outlets, payload) => {
    const { data, error } = await supabase.rpc("ingest_device_event", {
      p_external_id: externalId,
      p_outlets: outlets,
      p_payload: payload,
    });
    if (error) {
      console.error("ingest_device_event", externalId, error.message);
      return { error: error.message };
    }
    return { updated: data as number };
  }),
);
